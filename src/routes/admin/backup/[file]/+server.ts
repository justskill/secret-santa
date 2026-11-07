import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { error } from '@sveltejs/kit';
import { backupDir } from '$lib/server/env';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	// The strict pattern also stops a crafted name from reaching outside the backup folder.
	if (!/^santa-[0-9TZ-]+\.db$/.test(params.file)) throw error(404, 'Not found');
	const path = resolve(backupDir(), params.file);
	if (!existsSync(path)) throw error(404, 'Not found');
	return new Response(new Uint8Array(readFileSync(path)), {
		headers: {
			'Content-Type': 'application/octet-stream',
			'Content-Disposition': `attachment; filename="${params.file}"`
		}
	});
};
