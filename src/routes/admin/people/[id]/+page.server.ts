import { error, fail, redirect } from '@sveltejs/kit';
import { logAudit } from '$lib/server/audit';
import { createInviteLink, destroyAllSessionsFor, hasActiveInvite } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { deletePhoto, savePhoto } from '$lib/server/media';
import {
	explicitApproverIds,
	getPerson,
	guardiansOf,
	listHouseholds,
	listPeople,
	ORNAMENT_COLORS,
	setApprovers,
	setGuardians,
	toPublic,
	updatePerson
} from '$lib/server/people';
import { postNotice } from '$lib/server/notices';
import { currentSeason } from '$lib/server/season';
import { hasAssignment } from '$lib/server/draw';
import type { Actions, PageServerLoad } from './$types';

function requirePerson(id: string) {
	const person = getPerson(Number(id));
	if (!person) throw error(404, 'That person is not on the list.');
	return person;
}

export const load: PageServerLoad = ({ params }) => {
	const person = requirePerson(params.id);
	const season = currentSeason();
	return {
		person: {
			...toPublic(person),
			username: person.username,
			phone: person.phone,
			household_id: person.household_id,
			isAdmin: !!person.is_admin,
			active: !!person.active,
			canSignIn: !!person.password_hash,
			invited: hasActiveInvite(person.id),
			inDraw: season ? hasAssignment(season.id, person.id) : false
		},
		households: listHouseholds(),
		adults: listPeople()
			.filter((p) => p.kind === 'adult' && p.id !== person.id)
			.map((p) => ({ id: p.id, name: p.display_name })),
		guardianIds: guardiansOf(person.id).map((g) => g.id),
		approverIds: explicitApproverIds(person.id),
		colors: ORNAMENT_COLORS
	};
};

export const actions: Actions = {
	save: async ({ request, params, locals }) => {
		const person = requirePerson(params.id);
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { message: 'Please enter a name.' });
		const kind = form.get('kind') === 'kid' ? 'kid' : 'adult';
		const isAdmin = form.get('is_admin') === 'on';
		if (person.id === locals.viewer?.account.id && !isAdmin) {
			return fail(400, { message: "You can't remove your own admin access." });
		}
		const username = String(form.get('username') ?? '').trim();

		// Parents can open a kid's draw, so during a sealed draw these edits could be used to peek.
		const season = currentSeason();
		const sealedDraw = season?.status === 'sealed' && hasAssignment(season.id, person.id) ? season : null;
		if (sealedDraw && kind !== person.kind) {
			return fail(400, { message: "Someone can't switch between adult and kid while the names are sealed." });
		}
		const newGuardians = kind === 'kid' ? form.getAll('guardians').map(Number).filter(Boolean) : [];
		const oldGuardians = guardiansOf(person.id).map((g) => g.id);
		const guardiansChanged =
			newGuardians.length !== oldGuardians.length || newGuardians.some((id) => !oldGuardians.includes(id));

		try {
			updatePerson(person.id, {
				display_name: name,
				kind,
				household_id: Number(form.get('household')) || null,
				username: kind === 'adult' ? username || undefined : null,
				phone: String(form.get('phone') ?? ''),
				is_admin: isAdmin,
				color: String(form.get('color') ?? person.color)
			});
		} catch {
			return fail(400, { message: 'That sign-in name is already taken.' });
		}
		setGuardians(person.id, newGuardians);
		if (sealedDraw && guardiansChanged) {
			const names = guardiansOf(person.id).map((g) => g.display_name).join(', ') || 'nobody';
			logAudit(locals.viewer?.account.id ?? null, 'guardians.changed_while_sealed', person.display_name);
			postNotice({
				seasonId: sealedDraw.id,
				kind: 'alert',
				title: `The organizer changed who can open ${person.display_name}'s profile`,
				body: `This changed while the names are sealed. It's now: ${names}.`,
				link: '/fairness'
			});
		}
		setApprovers(person.id, form.getAll('approvers').map(Number).filter(Boolean));
		logAudit(locals.viewer?.account.id ?? null, 'person.updated', name);
		return { message: 'Saved.', ok: true };
	},

	invite: async ({ params, url, locals }) => {
		const person = requirePerson(params.id);
		if (person.kind !== 'adult') return fail(400, { message: "Kids use their parents' login." });
		const link = createInviteLink(person.id, url.origin);
		logAudit(locals.viewer?.account.id ?? null, 'invite.created', person.display_name);
		return { inviteLink: link, phone: person.phone, firstName: person.display_name.split(/\s+/)[0] };
	},

	signOutEverywhere: async ({ params }) => {
		const person = requirePerson(params.id);
		destroyAllSessionsFor(person.id);
		return { message: `${person.display_name} has been signed out on every device.`, ok: true };
	},

	photo: async ({ request, params }) => {
		const person = requirePerson(params.id);
		const form = await request.formData();
		const file = form.get('photo');
		if (!(file instanceof File) || !file.size) return fail(400, { message: 'Please choose a photo.' });
		const saved = await savePhoto(file);
		if (!saved.ok) return fail(400, { message: saved.message });
		deletePhoto(person.photo);
		updatePerson(person.id, { photo: saved.name });
		return { message: 'Photo saved.', ok: true };
	},

	active: async ({ request, params, locals }) => {
		const person = requirePerson(params.id);
		const form = await request.formData();
		const active = form.get('active') === '1';
		if (!active && person.id === locals.viewer?.account.id) {
			return fail(400, { message: "You can't deactivate yourself." });
		}
		const season = currentSeason();
		if (!active && season && season.status !== 'setup' && hasAssignment(season.id, person.id)) {
			return fail(400, { message: 'They are in the sealed draw. Remove them from the draw first, on the Draw page.' });
		}
		updatePerson(person.id, { active });
		if (!active) destroyAllSessionsFor(person.id);
		logAudit(locals.viewer?.account.id ?? null, active ? 'person.reactivated' : 'person.deactivated', person.display_name);
		return { message: active ? 'Reactivated.' : 'Deactivated.', ok: true };
	},

	delete: async ({ params, locals }) => {
		const person = requirePerson(params.id);
		if (person.id === locals.viewer?.account.id) return fail(400, { message: "You can't delete yourself." });
		const used = db().prepare('SELECT 1 FROM assignments WHERE giver_id = ? LIMIT 1').get(person.id);
		if (used) return fail(400, { message: 'They were part of a draw, so their history must stay. Deactivate them instead.' });
		deletePhoto(person.photo);
		db().prepare('DELETE FROM people WHERE id = ?').run(person.id);
		logAudit(locals.viewer?.account.id ?? null, 'person.deleted', person.display_name);
		throw redirect(303, '/admin/people');
	}
};
