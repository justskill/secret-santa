import { requireViewer } from '$lib/server/access';
import { hasRevealed } from '$lib/server/draw';
import { loadChat } from '$lib/server/santa/agent';
import { currentSeason } from '$lib/server/season';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const viewer = requireViewer(locals);
	const season = currentSeason();
	if (!season) return { hasSeason: false as const, turns: [], hasDrawn: false };
	return {
		hasSeason: true as const,
		turns: loadChat(season.id, viewer.profile.id),
		hasDrawn: hasRevealed(season.id, viewer.profile.id)
	};
};
