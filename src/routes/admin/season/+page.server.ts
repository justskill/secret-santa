import { fail } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/access';
import { logAudit } from '$lib/server/audit';
import {
	addAfterSealing,
	checkDraw,
	commitments,
	drawProgress,
	emergencyReveal,
	fullRedraw,
	hasAssignment,
	publishResults,
	removeAfterSealing,
	sealDraw
} from '$lib/server/draw';
import { listPeople } from '$lib/server/people';
import {
	addPairRule,
	createSeason,
	currentSeason,
	listPairRules,
	listSeasons,
	participantIds,
	removePairRule,
	setParticipants,
	setSeasonStatus,
	updateSeason
} from '$lib/server/season';
import { getSetting } from '$lib/server/settings';
import { utcToZonedInput, zonedInputToUtc } from '$lib/time';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const season = currentSeason();
	const people = listPeople().map((p) => ({ id: p.id, name: p.display_name, kind: p.kind }));
	if (!season) {
		return { season: null, people, pastSeasons: listSeasons().map((s) => ({ id: s.id, name: s.name, status: s.status })) };
	}
	const participants = participantIds(season.id);
	return {
		season: {
			id: season.id,
			name: season.name,
			status: season.status,
			spend_limit: season.spend_limit,
			house_rules: season.house_rules,
			draw_opens_input: utcToZonedInput(season.draw_opens_at, getSetting('timezone')),
			rule_guardian: !!season.rule_guardian,
			rule_household: !!season.rule_household,
			rule_no_reciprocal: !!season.rule_no_reciprocal,
			rule_no_repeat: !!season.rule_no_repeat
		},
		people,
		participants,
		pairRules: listPairRules(season.id),
		// Tests the rules without storing or showing a result. Only "how many options", never who.
		check: season.status === 'setup' ? checkDraw(season) : null,
		progress: season.status === 'setup' ? null : drawProgress(season.id),
		commitments: commitments(season.id),
		inDraw: people.map((p) => ({ ...p, included: hasAssignment(season.id, p.id) })),
		pastSeasons: listSeasons()
			.filter((s) => s.id !== season.id)
			.map((s) => ({ id: s.id, name: s.name, status: s.status }))
	};
};

const noSeason = () => fail(409, { message: 'There is no season running.' });

export const actions: Actions = {
	details: async ({ request }) => {
		const season = currentSeason();
		if (!season) return noSeason();
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { message: 'Please name the season.' });
		const opens = String(form.get('draw_opens') ?? '').trim();
		updateSeason(season.id, {
			name,
			spend_limit: String(form.get('spend_limit') ?? '').trim(),
			house_rules: String(form.get('house_rules') ?? '').trim(),
			draw_opens_at: opens ? zonedInputToUtc(opens, getSetting('timezone')) : null
		});
		return { message: 'Saved.', ok: true };
	},

	rules: async ({ request }) => {
		const season = currentSeason();
		if (!season) return noSeason();
		if (season.status !== 'setup') return fail(409, { message: 'The rules are locked once the names are sealed.' });
		const form = await request.formData();
		updateSeason(season.id, {
			rule_guardian: form.get('rule_guardian') === 'on' ? 1 : 0,
			rule_household: form.get('rule_household') === 'on' ? 1 : 0,
			rule_no_reciprocal: form.get('rule_no_reciprocal') === 'on' ? 1 : 0,
			rule_no_repeat: form.get('rule_no_repeat') === 'on' ? 1 : 0
		});
		return { message: 'Rules saved.', ok: true };
	},

	addPair: async ({ request }) => {
		const season = currentSeason();
		if (!season) return noSeason();
		if (season.status !== 'setup') return fail(409, { message: 'The rules are locked once the names are sealed.' });
		const form = await request.formData();
		const giver = Number(form.get('giver'));
		const receiver = Number(form.get('receiver'));
		if (!giver || !receiver || giver === receiver) return fail(400, { message: 'Pick two different people.' });
		addPairRule(season.id, giver, receiver, form.get('both_ways') === 'on', String(form.get('note') ?? ''));
		return { message: 'Rule added.', ok: true };
	},

	removePair: async ({ request }) => {
		const season = currentSeason();
		if (!season) return noSeason();
		if (season.status !== 'setup') return fail(409, { message: 'The rules are locked once the names are sealed.' });
		const form = await request.formData();
		removePairRule(season.id, Number(form.get('id')));
		return { message: 'Rule removed.', ok: true };
	},

	participants: async ({ request }) => {
		const season = currentSeason();
		if (!season) return noSeason();
		if (season.status !== 'setup') return fail(409, { message: 'Use the options below to change people after sealing.' });
		const form = await request.formData();
		setParticipants(season.id, form.getAll('people').map(Number).filter(Boolean));
		return { message: 'Saved.', ok: true };
	},

	seal: async ({ locals }) => {
		const viewer = requireAdmin(locals);
		const season = currentSeason();
		if (!season) return noSeason();
		const result = sealDraw(season, viewer.account.id);
		if (!result.ok) {
			const who = result.stuckNames.length ? ` (${result.stuckNames.join(', ')})` : '';
			return fail(400, { message: `${result.reason}${who}` });
		}
		return { message: "The names are sealed! The family has been told they're ready to open.", ok: true };
	},

	remove: async ({ request, locals }) => {
		const viewer = requireAdmin(locals);
		const season = currentSeason();
		if (!season) return noSeason();
		const form = await request.formData();
		const result = removeAfterSealing(season, Number(form.get('person')), viewer.account.id);
		if (!result.ok) return fail(400, { message: result.reason });
		return { message: `Done. ${result.changed} ${result.changed === 1 ? 'person has' : 'people have'} a new name and ${result.changed === 1 ? 'has' : 'have'} been asked to draw again.`, ok: true };
	},

	addLate: async ({ request, locals }) => {
		const viewer = requireAdmin(locals);
		const season = currentSeason();
		if (!season) return noSeason();
		const form = await request.formData();
		const result = addAfterSealing(season, Number(form.get('person')), viewer.account.id);
		if (!result.ok) return fail(400, { message: result.reason });
		return { message: `Done. ${result.changed} existing ${result.changed === 1 ? 'person has' : 'people have'} a new name, and the new person can draw now.`, ok: true };
	},

	redraw: async ({ request, locals }) => {
		const viewer = requireAdmin(locals);
		const season = currentSeason();
		if (!season) return noSeason();
		const form = await request.formData();
		const reason = String(form.get('reason') ?? '').trim();
		if (!reason) return fail(400, { message: 'Please give a reason. The whole family will see it.' });
		if (String(form.get('confirm') ?? '').trim().toUpperCase() !== 'REDRAW') {
			return fail(400, { message: 'Type REDRAW to confirm.' });
		}
		const removing = Number(form.get('remove_person')) || null;
		const adding = Number(form.get('add_person')) || null;
		const result = fullRedraw(season, reason, viewer.account.id, {
			remove: removing ? [removing] : [],
			add: adding ? [adding] : []
		});
		if (!result.ok) return fail(400, { message: result.reason });
		return { message: 'All names have been redrawn, and everyone has been told.', ok: true };
	},

	emergency: async ({ request, locals }) => {
		const viewer = requireAdmin(locals);
		const season = currentSeason();
		if (!season) return noSeason();
		if (season.status !== 'sealed') return fail(409, { message: 'The emergency reveal only works while the names are sealed.' });
		const form = await request.formData();
		const reason = String(form.get('reason') ?? '').trim();
		if (!reason) return fail(400, { message: 'Please give a reason. The whole family will see it.' });
		if (String(form.get('confirm') ?? '').trim().toUpperCase() !== 'I UNDERSTAND') {
			return fail(400, { message: 'Type I UNDERSTAND to confirm.' });
		}
		return { pairs: emergencyReveal(season, viewer.account.id, reason), message: 'The family has been notified.', ok: true };
	},

	publish: async ({ locals }) => {
		const viewer = requireAdmin(locals);
		const season = currentSeason();
		if (!season) return noSeason();
		if (season.status !== 'sealed') return fail(409, { message: 'Only a sealed draw can be published.' });
		publishResults(season, viewer.account.id);
		return { message: 'The big reveal is live!', ok: true };
	},

	archive: async ({ locals }) => {
		const viewer = requireAdmin(locals);
		const season = currentSeason();
		if (!season) return noSeason();
		// Archiving a sealed draw is refused, because that would leave its secrets in limbo.
		if (season.status === 'sealed') return fail(409, { message: 'Publish the big reveal first, then archive the season.' });
		setSeasonStatus(season.id, 'archived');
		logAudit(viewer.account.id, 'season.archived', season.name);
		return { message: 'Season archived. You can start a new one when you are ready.', ok: true };
	},

	create: async ({ request, locals }) => {
		const viewer = requireAdmin(locals);
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { message: 'Please name the season.' });
		if (currentSeason()) return fail(409, { message: 'Archive the current season first.' });
		createSeason(name);
		logAudit(viewer.account.id, 'season.created', name);
		return { message: 'New season started!', ok: true };
	}
};
