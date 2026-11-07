import { error, fail } from '@sveltejs/kit';
import { requireViewer } from '$lib/server/access';
import { currentSeason } from '$lib/server/season';
import {
	decideApproval,
	followUpFromBuyer,
	markThreadRead,
	RelayError,
	replyToBuyer,
	threadsAsAnswerer,
	threadsAsBuyer
} from '$lib/server/threads';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const viewer = requireViewer(locals);
	const season = currentSeason();
	if (!season) return { hasSeason: false as const, toMe: [], fromMe: [] };
	const toMe = threadsAsAnswerer(season.id, viewer.profile.id);
	const fromMe = threadsAsBuyer(season.id, viewer.profile.id);
	// Rows keep their "new" marker on this visit, and are marked read for the next one.
	for (const thread of [...toMe, ...fromMe]) {
		if (thread.unread) markThreadRead(thread.id, viewer.profile.id);
	}
	return { hasSeason: true as const, toMe, fromMe };
};

function run(work: () => void, success: string) {
	try {
		work();
	} catch (err) {
		if (err instanceof RelayError) return fail(400, { message: err.message, kind: 'bad' });
		throw err;
	}
	return { message: success, kind: 'good' };
}

function context(locals: App.Locals) {
	const viewer = requireViewer(locals);
	if (!currentSeason()) throw error(409, 'There is no season running right now.');
	return viewer;
}

export const actions: Actions = {
	reply: async ({ request, locals }) => {
		const viewer = context(locals);
		const form = await request.formData();
		return run(
			() => replyToBuyer(String(form.get('thread')), viewer.profile.id, String(form.get('text') ?? '')),
			'Santa passed along your answer.'
		);
	},
	followUp: async ({ request, locals }) => {
		const viewer = context(locals);
		const form = await request.formData();
		return run(
			() => followUpFromBuyer(String(form.get('thread')), viewer.profile.id, String(form.get('text') ?? '')),
			"Your follow-up is on its way. It will arrive after a short, random delay."
		);
	},
	decide: async ({ request, locals }) => {
		const viewer = context(locals);
		const form = await request.formData();
		const approved = form.get('decision') === 'approve';
		return run(
			() => decideApproval(String(form.get('thread')), viewer.profile.id, approved, String(form.get('note') ?? '')),
			approved ? 'Approved. Santa passed it along.' : 'Declined. Santa passed it along.'
		);
	}
};
