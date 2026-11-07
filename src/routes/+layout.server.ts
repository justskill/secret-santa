import { drawIsOpen, hasAssignment, hasRevealed } from '$lib/server/draw';
import { isDemoMode } from '$lib/server/env';
import { unreadCount, unreadPersonalCount } from '$lib/server/notices';
import { toPublic } from '$lib/server/people';
import { currentSeason } from '$lib/server/season';
import { getSetting } from '$lib/server/settings';
import { mailBadgeCount, waitingOnMe } from '$lib/server/threads';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, url, depends }) => {
	// Using the path makes this rerun on each navigation, which keeps the unread badges current.
	void url.pathname;
	depends('app:badges');
	const viewer = locals.viewer;
	const season = currentSeason();
	const mailFor = (personId: number) => (season ? mailBadgeCount(season.id, personId) : 0);
	const badgeFor = (personId: number) => unreadPersonalCount(personId) + mailFor(personId);
	const drawReadyFor = (personId: number) =>
		season?.status === 'sealed' && drawIsOpen(season) && hasAssignment(season.id, personId) && !hasRevealed(season.id, personId);
	const needsYou = (personId: number) => ({
		drawReady: drawReadyFor(personId),
		waiting: season ? waitingOnMe(season.id, personId).length : 0
	});

	return {
		familyName: getSetting('family_name'),
		timeZone: getSetting('timezone'),
		demo: isDemoMode(),
		season: season ? { id: season.id, name: season.name, status: season.status } : null,
		viewer: viewer
			? {
					account: { ...toPublic(viewer.account), isAdmin: viewer.isAdmin },
					profile: toPublic(viewer.profile),
					helping: viewer.profile.id !== viewer.account.id,
					wards: viewer.wards.map((ward) => ({ ...toPublic(ward), badge: badgeFor(ward.id), ...needsYou(ward.id) })),
					accountBadge: badgeFor(viewer.account.id),
					accountNeeds: needsYou(viewer.account.id),
					drawReady: drawReadyFor(viewer.profile.id),
					badges: {
						notices: unreadCount(viewer.profile.id) + mailFor(viewer.profile.id),
						mail: mailFor(viewer.profile.id)
					}
				}
			: null
	};
};
