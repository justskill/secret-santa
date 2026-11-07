import { error, redirect, type Handle, type HandleServerError, type ServerInit } from '@sveltejs/kit';
import { buildViewer } from '$lib/server/access';
import { getSetupToken, readSession, SESSION_COOKIE } from '$lib/server/auth';
import { seedDemoIfEmpty } from '$lib/server/demo';
import { isDemoMode, publicUrl } from '$lib/server/env';
import { adminExists, getPerson } from '$lib/server/people';
import { startScheduler } from '$lib/server/scheduler';

export const init: ServerInit = async () => {
	// One failed background task should be logged, not take the whole family's site offline.
	process.on('unhandledRejection', (reason) => console.error('[santa] Unhandled rejection:', reason));
	console.log(`[santa] Secret Santa ${__APP_VERSION__} is starting.`);

	if (isDemoMode()) {
		const seeded = await seedDemoIfEmpty();
		if (seeded) console.log('[santa] Demo family created. See the login page for sign-ins.');
	}
	if (!adminExists()) {
		console.log(`[santa] First-run setup link: ${publicUrl()}/setup?token=${getSetupToken()}`);
	}
	startScheduler();
};

/** Pages anyone can reach without signing in. Everything else requires a session. */
const PUBLIC_ROUTES = new Set(['/login', '/invite/[token]', '/setup', '/healthz']);

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.viewer = null;
	event.locals.sessionToken = null;

	const token = event.cookies.get(SESSION_COOKIE);
	if (token) {
		const session = readSession(token);
		if (session) {
			event.locals.sessionToken = token;
			event.locals.viewer = buildViewer(session.account, session.actingId, getPerson);
		}
	}

	// This guard runs for page loads, form actions, and API endpoints alike. Layout loads alone would
	// not protect form actions or API routes.
	const routeId = event.route.id;
	if (routeId && !PUBLIC_ROUTES.has(routeId)) {
		if (!event.locals.viewer) {
			if (routeId.startsWith('/api') || routeId.startsWith('/media')) throw error(401, 'Please sign in.');
			if (event.request.method === 'GET') {
				const next = event.url.pathname === '/' ? '' : `?next=${encodeURIComponent(event.url.pathname)}`;
				throw redirect(303, `/login${next}`);
			}
			throw error(401, 'Please sign in.');
		}
		if (routeId.startsWith('/admin') && !event.locals.viewer.isAdmin) {
			throw error(403, 'Only the head elf can open this page.');
		}
	}

	const response = await resolve(event);
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	// Clicking a wish list link must not tell the store where the click came from. This can't be
	// "no-referrer": browsers then send a blank origin on plain form posts, and those get rejected
	// as cross-site. That broke signing out, and would break every form if JavaScript failed to load.
	response.headers.set('Referrer-Policy', 'same-origin');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	if (!routeId?.startsWith('/media')) {
		response.headers.set('Cache-Control', 'private, no-store');
	}
	return response;
};

export const handleError: HandleServerError = ({ error: err, status }) => {
	if (status !== 404) console.error('[santa] Unexpected error:', err);
	return { message: status === 404 ? 'The elves could not find that page.' : 'Something went wrong in the workshop.' };
};
