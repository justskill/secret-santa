import { error } from '@sveltejs/kit';
import { fetchLinkPreview } from '$lib/server/linkpreview';
import { cacheRemoteImage } from '$lib/server/media';
import { parsePublicUrl } from '$lib/server/safefetch';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { url?: unknown };
	const url = typeof body.url === 'string' ? body.url : '';
	if (!parsePublicUrl(url)) throw error(400, 'That does not look like a web link.');
	const preview = await fetchLinkPreview(url);
	return Response.json({ ...preview, image: await cacheRemoteImage(preview.image) });
};
