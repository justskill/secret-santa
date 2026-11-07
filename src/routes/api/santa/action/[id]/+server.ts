import { error } from '@sveltejs/kit';
import { requireViewer } from '$lib/server/access';
import { decideAction } from '$lib/server/santa/actions';
import { saveTurn } from '$lib/server/santa/agent';
import { currentSeason } from '$lib/server/season';
import type { RequestHandler } from './$types';

/** A person's tap on one of Santa's cards. Only the profile the card belongs to can use it. */
export const POST: RequestHandler = async ({ request, params, locals }) => {
	const viewer = requireViewer(locals);
	const body = (await request.json().catch(() => ({}))) as { decision?: unknown; text?: unknown };
	if (body.decision !== 'confirm' && body.decision !== 'cancel') throw error(400, 'Pick confirm or cancel.');

	const result = decideAction(
		params.id,
		viewer.profile,
		body.decision,
		typeof body.text === 'string' ? body.text : undefined
	);
	if (!result.ok) throw error(result.status, result.message);

	const season = currentSeason();
	if (season) saveTurn(season.id, viewer.profile.id, viewer.account.id, 'event', result.event);
	return Response.json({ card: result.card });
};
