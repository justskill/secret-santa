import { fail } from '@sveltejs/kit';
import { deleteAnnouncement, familyAnnouncements, postNotice } from '$lib/server/notices';
import { currentSeason } from '$lib/server/season';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ notices: familyAnnouncements() });

export const actions: Actions = {
	post: async ({ request }) => {
		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();
		if (!title) return fail(400, { message: 'Please write a headline.' });
		postNotice({
			seasonId: currentSeason()?.id,
			kind: 'info',
			title,
			body: String(form.get('body') ?? '').trim()
		});
		return { message: 'Posted to the whole family.', ok: true };
	},
	delete: async ({ request }) => {
		const form = await request.formData();
		deleteAnnouncement(Number(form.get('id')));
		return { message: 'Removed.', ok: true };
	}
};
