import { error } from '@sveltejs/kit';
import { requireViewer } from '$lib/server/access';
import { approversFor, listPeople, toPublic, type Person } from '$lib/server/people';
import { getGuidance, setGuidance } from '$lib/server/wishlist';
import type { Actions, PageServerLoad } from './$types';

function peopleIHelp(accountId: number): Person[] {
	return listPeople().filter(
		(person) => person.id !== accountId && approversFor(person.id).some((approver) => approver.id === accountId)
	);
}

export const load: PageServerLoad = ({ locals }) => {
	const viewer = requireViewer(locals);
	return {
		people: peopleIHelp(viewer.account.id).map((person) => ({
			...toPublic(person),
			guidance: getGuidance(person.id)
		}))
	};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const viewer = requireViewer(locals);
		const form = await request.formData();
		const personId = Number(form.get('person'));
		const person = peopleIHelp(viewer.account.id).find((candidate) => candidate.id === personId);
		if (!person) throw error(403, 'You are not set up to help this person.');
		// A kid has no login of their own, so their parents also manage the notes they would write.
		setGuidance(person.id, {
			helper_notes: String(form.get('helper_notes') ?? ''),
			...(person.kind === 'kid' ? { notes: String(form.get('notes') ?? '') } : {})
		});
		return { savedFor: person.id };
	}
};
