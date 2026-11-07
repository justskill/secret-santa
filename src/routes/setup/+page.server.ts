import { fail, redirect } from '@sveltejs/kit';
import { checkSetupToken, createSession, getSetupToken, MIN_PASSWORD_LENGTH, setSessionCookie } from '$lib/server/auth';
import { hashPassword } from '$lib/server/crypto';
import { adminExists, createPerson, setPasswordHash } from '$lib/server/people';
import { createSeason, currentSeason } from '$lib/server/season';
import { setSetting } from '$lib/server/settings';
import { isValidTimeZone } from '$lib/time';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	if (adminExists()) throw redirect(303, '/login');
	getSetupToken();
	return { token: url.searchParams.get('token') ?? '', minLength: MIN_PASSWORD_LENGTH };
};

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		if (adminExists()) throw redirect(303, '/login');
		const form = await request.formData();
		const token = String(form.get('token') ?? '').trim();
		const name = String(form.get('name') ?? '').trim();
		const username = String(form.get('username') ?? '').trim();
		const password = String(form.get('password') ?? '');
		const family = String(form.get('family') ?? '').trim();
		const timeZone = String(form.get('timezone') ?? '').trim();

		const values = { token, name, username, family, timezone: timeZone };
		if (!checkSetupToken(token)) {
			return fail(403, { ...values, message: "That setup code isn't right. It's printed in the server log." });
		}
		if (!name || !username) return fail(400, { ...values, message: 'Please fill in your name and sign-in name.' });
		if (password.length < MIN_PASSWORD_LENGTH) {
			return fail(400, { ...values, message: `Please choose a password with at least ${MIN_PASSWORD_LENGTH} characters.` });
		}

		const person = createPerson({ display_name: name, kind: 'adult', username, is_admin: true, color: 'pine' });
		setPasswordHash(person.id, await hashPassword(password));
		if (family) setSetting('family_name', family);
		if (isValidTimeZone(timeZone)) setSetting('timezone', timeZone);
		if (!currentSeason()) createSeason(`Christmas ${new Date().getFullYear()}`);

		setSessionCookie(cookies, createSession(person.id), url.protocol === 'https:');
		throw redirect(303, '/admin');
	}
};
