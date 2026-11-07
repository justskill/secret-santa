import { requireViewer } from '$lib/server/access';
import { visibleCountdowns } from '$lib/server/countdowns';
import { homeTasks, santaGreeting } from '$lib/server/home';
import { noticesFor } from '$lib/server/notices';
import { currentSeason } from '$lib/server/season';
import { waitingOnMe } from '$lib/server/threads';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const viewer = requireViewer(locals);
	const season = currentSeason();
	const tasks = season ? homeTasks(season, viewer.profile) : [];
	const countdowns = season ? visibleCountdowns(season.id) : [];
	// The nearest big date leads the page. Passed dates drop to the end.
	const now = new Date().toISOString();
	const ordered = [...countdowns.filter((c) => c.target_at > now), ...countdowns.filter((c) => c.target_at <= now)];
	const lead = ordered.find((c) => c.kind === 'exchange') ?? ordered[0] ?? null;

	return {
		greeting: santaGreeting(season, viewer.profile, tasks),
		tasks,
		lead,
		countdowns: ordered.filter((c) => c.id !== lead?.id),
		notices: noticesFor(viewer.profile.id, 4),
		waiting: season ? waitingOnMe(season.id, viewer.profile.id) : [],
		revealed: season?.status === 'revealed'
	};
};
