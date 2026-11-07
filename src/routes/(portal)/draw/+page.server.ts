import { requireViewer } from '$lib/server/access';
import { drawIsOpen, hasAssignment, myRecipient } from '$lib/server/draw';
import { getPerson, toPublic } from '$lib/server/people';
import { currentSeason, participantIds } from '$lib/server/season';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const viewer = requireViewer(locals);
	const season = currentSeason();
	const profile = toPublic(viewer.profile);
	const base = { profile, helping: viewer.profile.id !== viewer.account.id };

	if (!season || season.status === 'setup') {
		return { ...base, state: 'not_sealed' as const, reel: [], recipient: null, opensAt: null };
	}
	if (!hasAssignment(season.id, viewer.profile.id)) {
		return { ...base, state: 'not_in_draw' as const, reel: [], recipient: null, opensAt: null };
	}
	if (!drawIsOpen(season)) {
		return { ...base, state: 'not_open' as const, reel: [], recipient: null, opensAt: season.draw_opens_at };
	}

	// The reel shows everyone but this person, so it says nothing about the result.
	const reel = participantIds(season.id)
		.filter((id) => id !== viewer.profile.id)
		.map((id) => getPerson(id))
		.filter((person) => !!person)
		.map((person) => toPublic(person!));

	const recipient = myRecipient(season.id, viewer.profile.id);
	return {
		...base,
		state: recipient ? ('revealed' as const) : ('ready' as const),
		reel,
		recipient: recipient ? toPublic(recipient) : null,
		opensAt: null
	};
};
