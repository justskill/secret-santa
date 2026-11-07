import { fail, type ActionFailure } from '@sveltejs/kit';
import { cacheRemoteImage } from '$lib/server/media';
import { requireViewer } from '$lib/server/access';
import { listDeadline, listIsLocked } from '$lib/server/countdowns';
import { coveredItemIds } from '$lib/server/gifts';
import { aiAvailable } from '$lib/server/santa/client';
import { currentSeason } from '$lib/server/season';
import {
	addItem,
	cleanUrl,
	getGuidance,
	getListMeta,
	ListLockedError,
	listItems,
	removeItem,
	setAmazonUrl,
	setGuidance,
	setIntroNote,
	setListReady,
	updateItem,
	type WishItemInput
} from '$lib/server/wishlist';
import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const viewer = requireViewer(locals);
	const season = currentSeason();
	if (!season) return { hasSeason: false as const };
	return {
		hasSeason: true as const,
		items: listItems(season.id, viewer.profile.id),
		meta: getListMeta(season.id, viewer.profile.id),
		locked: listIsLocked(season.id),
		deadline: listDeadline(season.id),
		// Only the notes they wrote. Whispers from their family are for their Santa, not for them.
		guidance: { notes: getGuidance(viewer.profile.id).notes },
		aiReady: aiAvailable(),
		// Only a parent helping their kid gets this. It never says who bought what.
		covered: viewer.profile.id !== viewer.account.id ? coveredItemIds(season.id, viewer.profile.id) : []
	};
};

function readItem(form: FormData): WishItemInput {
	return {
		title: String(form.get('title') ?? ''),
		url: String(form.get('url') ?? ''),
		image_url: String(form.get('image_url') ?? ''),
		price_text: String(form.get('price_text') ?? ''),
		notes: String(form.get('notes') ?? ''),
		priority: Number(form.get('priority') ?? 2)
	};
}

async function guarded<T>(work: () => T | Promise<T>): Promise<T | ActionFailure<{ message: string }>> {
	try {
		return await work();
	} catch (err) {
		if (err instanceof ListLockedError) return fail(403, { message: err.message });
		throw err;
	}
}

function context(locals: App.Locals) {
	const viewer = requireViewer(locals);
	const season = currentSeason();
	if (!season) throw error(409, 'There is no season running right now.');
	return { viewer, season };
}

export const actions: Actions = {
	add: async ({ request, locals }) => {
		const { viewer, season } = context(locals);
		const form = await request.formData();
		const item = readItem(form);
		if (!item.title.trim()) return fail(400, { message: 'A wish needs a name.' });
		if (String(form.get('url') ?? '').trim() && !cleanUrl(item.url)) {
			return fail(400, { message: "That link doesn't look right. It should start with https://" });
		}
		return guarded(() => {
			addItem(season, viewer.profile.id, item);
			return { message: 'Added to the list!' };
		});
	},

	update: async ({ request, locals }) => {
		const { viewer, season } = context(locals);
		const form = await request.formData();
		const item = readItem(form);
		if (!item.title.trim()) return fail(400, { message: 'A wish needs a name.' });
		return guarded(() => {
			if (!updateItem(season, viewer.profile.id, Number(form.get('id')), item)) {
				return fail(404, { message: 'That wish could not be found.' });
			}
			return { message: 'Saved.' };
		});
	},

	remove: async ({ request, locals }) => {
		const { viewer, season } = context(locals);
		const form = await request.formData();
		return guarded(() => {
			removeItem(season, viewer.profile.id, Number(form.get('id')));
			return { message: 'Removed.' };
		});
	},

	addMany: async ({ request, locals }) => {
		const { viewer, season } = context(locals);
		const form = await request.formData();
		let items: WishItemInput[];
		try {
			items = JSON.parse(String(form.get('items') ?? '[]')) as WishItemInput[];
		} catch {
			return fail(400, { message: 'Those items could not be read.' });
		}
		if (!Array.isArray(items) || !items.length) return fail(400, { message: 'Pick at least one item.' });
		const kept = items.slice(0, 50).filter((item) => item?.title?.trim());
		// Images are copied here first, so a Santa's browser never contacts someone else's server.
		const images = await Promise.all(kept.map((item) => cacheRemoteImage(item.image_url)));
		return guarded(() => {
			kept.forEach((item, index) => addItem(season, viewer.profile.id, { ...item, image_url: images[index] }, 'import'));
			return { message: `Added ${items.length} ${items.length === 1 ? 'wish' : 'wishes'} to the list!` };
		});
	},

	amazon: async ({ request, locals }) => {
		const { viewer, season } = context(locals);
		const form = await request.formData();
		const raw = String(form.get('amazon_url') ?? '').trim();
		if (raw && !cleanUrl(raw)) return fail(400, { message: "That link doesn't look right. It should start with https://" });
		return guarded(() => {
			setAmazonUrl(season, viewer.profile.id, raw || null);
			return { message: raw ? 'Your list link is saved.' : 'Your list link is removed.' };
		});
	},

	ready: async ({ request, locals }) => {
		const { viewer, season } = context(locals);
		const form = await request.formData();
		const ready = form.get('ready') === '1';
		return guarded(() => {
			setListReady(season, viewer.profile, ready);
			return { message: ready ? 'Marked as ready. Santa will let their shopper know!' : 'Reopened.' };
		});
	},

	note: async ({ request, locals }) => {
		const { viewer, season } = context(locals);
		const form = await request.formData();
		return guarded(() => {
			setIntroNote(season, viewer.profile.id, String(form.get('intro_note') ?? ''));
			setGuidance(viewer.profile.id, { notes: String(form.get('notes') ?? '') });
			return { message: 'Notes saved.' };
		});
	}
};
