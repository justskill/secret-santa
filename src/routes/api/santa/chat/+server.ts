import { error } from '@sveltejs/kit';
import { requireViewer } from '$lib/server/access';
import { runSantaTurn, type SantaEvent } from '$lib/server/santa/agent';
import { currentSeason } from '$lib/server/season';
import type { RequestHandler } from './$types';

const MAX_MESSAGE = 2000;

/** Streams Santa's reply. Who is talking comes from the session, never from the request body. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const viewer = requireViewer(locals);
	const season = currentSeason();
	if (!season) throw error(409, 'There is no season running right now.');

	const body = (await request.json().catch(() => ({}))) as { message?: unknown };
	const message = typeof body.message === 'string' ? body.message.trim().slice(0, MAX_MESSAGE) : '';
	if (!message) throw error(400, 'Say something to Santa first.');

	const abort = new AbortController();
	const encoder = new TextEncoder();

	let closed = false;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const emit = (event: SantaEvent) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
				} catch {
					closed = true;
				}
			};
			void runSantaTurn(season, viewer.profile, viewer.account, message, emit, abort.signal)
				.catch((err) => console.error('Santa chat failed:', err))
				.finally(() => {
					if (closed) return;
					closed = true;
					try {
						controller.close();
					} catch {
						// The browser left at the same moment. There is nothing left to tell it.
					}
				});
		},
		cancel() {
			// The browser went away, by closing the tab or losing signal.
			closed = true;
			abort.abort();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-cache, no-transform',
			// Tells nginx-style reverse proxies not to hold the reply back until it finishes.
			'X-Accel-Buffering': 'no'
		}
	});
};
