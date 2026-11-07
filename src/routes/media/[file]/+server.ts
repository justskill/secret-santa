import { error } from '@sveltejs/kit';
import { readPhoto } from '$lib/server/media';
import type { RequestHandler } from './$types';

/** Family photos are only served to signed-in family members (enforced in hooks.server.ts). */
export const GET: RequestHandler = ({ params }) => {
	const photo = readPhoto(params.file);
	if (!photo) throw error(404, 'Not found');
	return new Response(new Uint8Array(photo.bytes), {
		headers: {
			'Content-Type': photo.type,
			'Cache-Control': 'private, max-age=86400',
			'Content-Security-Policy': "default-src 'none'"
		}
	});
};
