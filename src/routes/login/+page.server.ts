import { fail, redirect } from '@sveltejs/kit';
import { logAudit, logUnsignedEvent } from '$lib/server/audit';
import { attemptLogin, createSession, firstTurnAway, isThrottled, safeReturnPath, setSessionCookie } from '$lib/server/auth';
import { DEMO_LOGINS, DEMO_PASSWORD } from '$lib/server/demo';
import { isDemoMode } from '$lib/server/env';
import { adminExists, wardsOf } from '$lib/server/people';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.viewer) throw redirect(303, '/');
	return {
		needsSetup: !adminExists(),
		demoLogins: isDemoMode() ? DEMO_LOGINS : null,
		demoPassword: isDemoMode() ? DEMO_PASSWORD : null
	};
};

function clientAddress(getClientAddress: () => string): string {
	try {
		return getClientAddress();
	} catch {
		return 'unknown';
	}
}

/**
 * Sign-ins are counted, but the counts never hold the name that was typed (it can be a misspelled
 * real name) or the address it came from. Only a successful sign-in says who it was.
 */
export const actions: Actions = {
	default: async ({ request, cookies, url, getClientAddress }) => {
		const form = await request.formData();
		const username = String(form.get('username') ?? '').trim();
		const password = String(form.get('password') ?? '');
		const ip = clientAddress(getClientAddress);

		if (!username || !password) return fail(400, { username, message: 'Please enter your name and password.' });
		if (isThrottled(ip, username)) {
			if (firstTurnAway(ip, username)) logUnsignedEvent('login.throttled');
			return fail(429, { username, message: 'Too many tries. Please wait 15 minutes, or ask for a new invite link.' });
		}
		const person = await attemptLogin(ip, username, password);
		if (!person) {
			logUnsignedEvent('login.failed');
			return fail(400, { username, message: "That didn't match. Check the spelling, or ask for a new invite link." });
		}
		setSessionCookie(cookies, createSession(person.id), url.protocol === 'https:');
		logAudit(person.id, 'login.ok');
		throw redirect(303, safeReturnPath(url.searchParams.get('next'), url.origin) ?? (wardsOf(person.id).length ? '/profiles' : '/'));
	}
};
