import { fail, redirect } from '@sveltejs/kit';
import { acceptInvite, createSession, MIN_PASSWORD_LENGTH, personForInvite, setSessionCookie } from '$lib/server/auth';
import { firstNameOf, wardsOf } from '$lib/server/people';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const person = personForInvite(params.token);
	return {
		valid: !!person,
		firstName: person ? firstNameOf(person.display_name) : null,
		username: person?.username ?? null,
		minLength: MIN_PASSWORD_LENGTH
	};
};

export const actions: Actions = {
	default: async ({ request, params, cookies, url }) => {
		const form = await request.formData();
		const password = String(form.get('password') ?? '');
		const confirm = String(form.get('confirm') ?? '');
		if (password.length < MIN_PASSWORD_LENGTH) {
			return fail(400, { message: `Please choose a password with at least ${MIN_PASSWORD_LENGTH} characters.` });
		}
		if (password !== confirm) return fail(400, { message: "Those two passwords don't match." });

		const person = await acceptInvite(params.token, password);
		if (!person) return fail(400, { message: 'This invite link has expired or was already used. Ask for a new one.' });

		setSessionCookie(cookies, createSession(person.id), url.protocol === 'https:');
		throw redirect(303, wardsOf(person.id).length ? '/profiles' : '/');
	}
};
