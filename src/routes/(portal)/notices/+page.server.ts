import { requireViewer } from '$lib/server/access';
import { markAllRead, noticesFor } from '$lib/server/notices';
import { currentSeason } from '$lib/server/season';
import { waitingOnMe } from '$lib/server/threads';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const viewer = requireViewer(locals);
	const notices = noticesFor(viewer.profile.id, 100);
	// Rows keep their "unread" look on this visit, and are marked read for the next one.
	markAllRead(viewer.profile.id);
	const season = currentSeason();
	return { notices, waiting: season ? waitingOnMe(season.id, viewer.profile.id) : [] };
};
