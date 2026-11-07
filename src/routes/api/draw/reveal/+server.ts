import { error } from '@sveltejs/kit';
import { requireViewer } from '$lib/server/access';
import { revealMyDraw } from '$lib/server/draw';
import { toPublic } from '$lib/server/people';
import { currentSeason } from '$lib/server/season';
import type { RequestHandler } from './$types';

/**
 * The name only leaves the server at this moment, when someone finishes opening their name.
 * The acting profile comes from the session, so nobody can ask for another person's draw.
 */
export const POST: RequestHandler = ({ locals }) => {
	const viewer = requireViewer(locals);
	const season = currentSeason();
	if (!season) throw error(404, 'There is no draw right now.');
	const recipient = revealMyDraw(season, viewer.profile.id);
	if (!recipient) throw error(409, 'Your name is not ready to open yet.');
	return Response.json({ recipient: toPublic(recipient) });
};
