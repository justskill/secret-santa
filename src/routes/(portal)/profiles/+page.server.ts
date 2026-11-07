import { error, redirect } from '@sveltejs/kit';
import { canActAs, requireViewer } from '$lib/server/access';
import { setActingProfile } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const viewer = requireViewer(locals);
	if (!viewer.wards.length) throw redirect(303, '/');
	return {};
};

export const actions: Actions = {
	switch: async ({ request, locals }) => {
		const viewer = requireViewer(locals);
		const form = await request.formData();
		const personId = Number(form.get('person'));
		if (!canActAs(viewer, personId) || !locals.sessionToken) throw error(403, 'That is not one of your profiles.');
		setActingProfile(locals.sessionToken, personId);
		throw redirect(303, '/');
	}
};
