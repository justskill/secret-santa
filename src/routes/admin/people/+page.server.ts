import { fail } from '@sveltejs/kit';
import { hasActiveInvite } from '$lib/server/auth';
import {
	approversFor,
	createHousehold,
	createPerson,
	deleteHousehold,
	explicitApproverIds,
	guardiansOf,
	listHouseholds,
	listPeople,
	renameHousehold,
	setGuardians,
	toPublic
} from '$lib/server/people';
import { currentSeason, setParticipant } from '$lib/server/season';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const households = listHouseholds();
	const householdName = new Map(households.map((h) => [h.id, h.name]));
	return {
		households,
		people: listPeople({ includeInactive: true }).map((person) => ({
			...toPublic(person),
			active: !!person.active,
			isAdmin: !!person.is_admin,
			username: person.username,
			household: person.household_id ? (householdName.get(person.household_id) ?? null) : null,
			guardians: guardiansOf(person.id).map((g) => g.display_name),
			approvers: approversFor(person.id).map((a) => a.display_name),
			approverIsAutomatic: explicitApproverIds(person.id).length === 0,
			hasPhone: !!person.phone,
			canSignIn: !!person.password_hash,
			invited: hasActiveInvite(person.id)
		})),
		adults: listPeople().filter((p) => p.kind === 'adult').map((p) => ({ id: p.id, name: p.display_name, household_id: p.household_id }))
	};
};

export const actions: Actions = {
	add: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const kind = form.get('kind') === 'kid' ? 'kid' : 'adult';
		if (!name) return fail(400, { addMessage: 'Please enter a name.' });

		let householdId: number | null = Number(form.get('household')) || null;
		const newHousehold = String(form.get('new_household') ?? '').trim();
		if (newHousehold) householdId = createHousehold(newHousehold).id;

		let person;
		try {
			person = createPerson({
				display_name: name,
				kind,
				household_id: householdId,
				phone: String(form.get('phone') ?? '')
			});
		} catch {
			return fail(400, { addMessage: 'Someone with that sign-in name already exists.' });
		}
		if (kind === 'kid') {
			setGuardians(person.id, form.getAll('guardians').map(Number).filter(Boolean));
		}
		const season = currentSeason();
		if (season?.status === 'setup') setParticipant(season.id, person.id, true);
		return { addMessage: `${name} is on the list!`, added: true };
	},

	addHousehold: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { householdMessage: 'Please enter a household name.' });
		createHousehold(name);
		return { householdMessage: 'Household added.' };
	},

	renameHousehold: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { householdMessage: 'Please enter a household name.' });
		renameHousehold(Number(form.get('id')), name);
		return { householdMessage: 'Household renamed.' };
	},

	deleteHousehold: async ({ request }) => {
		const form = await request.formData();
		deleteHousehold(Number(form.get('id')));
		return { householdMessage: 'Household removed. Its members are still on the list.' };
	}
};
