import { fail } from '@sveltejs/kit';
import { requireViewer } from '$lib/server/access';
import { changePassword, destroyAllSessionsFor, MIN_PASSWORD_LENGTH } from '$lib/server/auth';
import { deletePhoto, savePhoto } from '$lib/server/media';
import { updatePerson } from '$lib/server/people';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const viewer = requireViewer(locals);
	return { username: viewer.account.username, minLength: MIN_PASSWORD_LENGTH };
};

export const actions: Actions = {
	photo: async ({ request, locals }) => {
		const viewer = requireViewer(locals);
		const form = await request.formData();
		const file = form.get('photo');
		if (!(file instanceof File) || !file.size) return fail(400, { photoMessage: 'Please choose a photo.' });
		const saved = await savePhoto(file);
		if (!saved.ok) return fail(400, { photoMessage: saved.message });
		deletePhoto(viewer.profile.photo);
		updatePerson(viewer.profile.id, { photo: saved.name });
		return { photoMessage: 'Looking good!', photoOk: true };
	},

	removePhoto: async ({ locals }) => {
		const viewer = requireViewer(locals);
		deletePhoto(viewer.profile.photo);
		updatePerson(viewer.profile.id, { photo: null });
		return { photoMessage: 'Photo removed.', photoOk: true };
	},

	password: async ({ request, locals }) => {
		const viewer = requireViewer(locals);
		const form = await request.formData();
		const current = String(form.get('current') ?? '');
		const next = String(form.get('next') ?? '');
		if (next.length < MIN_PASSWORD_LENGTH) {
			return fail(400, { passwordMessage: `Please use at least ${MIN_PASSWORD_LENGTH} characters.` });
		}
		if (!(await changePassword(viewer.account, current, next))) {
			return fail(400, { passwordMessage: "Your current password didn't match." });
		}
		destroyAllSessionsFor(viewer.account.id, locals.sessionToken ?? undefined);
		return { passwordMessage: 'Password changed. Other devices have been signed out.', passwordOk: true };
	}
};
