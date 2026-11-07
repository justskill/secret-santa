import { requireViewer } from '$lib/server/access';
import { aiAvailable } from '$lib/server/santa/client';
import { extractWishItems } from '$lib/server/santa/writing';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const viewer = requireViewer(locals);
	const body = (await request.json().catch(() => ({}))) as { text?: unknown };
	const text = typeof body.text === 'string' ? body.text.trim() : '';
	if (!text) return Response.json({ message: 'Paste your list first.' }, { status: 400 });
	if (!aiAvailable()) return Response.json({ message: "Santa's helper is resting right now." }, { status: 503 });

	const items = await extractWishItems(text, viewer.account.id);
	if (!items) return Response.json({ message: "Santa couldn't read that. You can add wishes one at a time instead." }, { status: 502 });
	return Response.json({ items });
};
