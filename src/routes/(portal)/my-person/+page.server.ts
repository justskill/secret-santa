import { error, fail } from '@sveltejs/kit';
import { requireViewer } from '$lib/server/access';
import { drawIsOpen, hasRevealed, myRecipient } from '$lib/server/draw';
import { createOffListGift, myGifts, removeMyGift, setGiftBought, setItemBought } from '$lib/server/gifts';
import { toPublic } from '$lib/server/people';
import { currentSeason } from '$lib/server/season';
import {
	askQuestion,
	effectiveApprovers,
	RelayError,
	requestApproval,
	resolveRelayUrl,
	threadsAsBuyer
} from '$lib/server/threads';
import { cleanUrl, getGuidance, getListMeta, listItems } from '$lib/server/wishlist';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const viewer = requireViewer(locals);
	const season = currentSeason();
	if (!season) return { state: 'no_season' as const };

	const recipient = myRecipient(season.id, viewer.profile.id);
	if (!recipient) {
		return {
			state: 'not_drawn' as const,
			drawOpen: drawIsOpen(season) && !hasRevealed(season.id, viewer.profile.id)
		};
	}

	const gifts = myGifts(season.id, viewer.profile.id);
	const boughtItemIds = gifts.filter((gift) => gift.wish_item_id && gift.bought).map((gift) => gift.wish_item_id);
	const guidance = getGuidance(recipient.id);
	const threads = threadsAsBuyer(season.id, viewer.profile.id).filter((thread) => thread.status !== 'closed');

	return {
		state: 'ready' as const,
		recipient: toPublic(recipient),
		items: listItems(season.id, recipient.id),
		meta: getListMeta(season.id, recipient.id),
		guidance: { notes: guidance.notes, helper_notes: guidance.helper_notes },
		boughtItemIds,
		offListGifts: gifts
			.filter((gift) => gift.off_list)
			.map((gift) => ({
				id: gift.id,
				title: gift.title,
				url: gift.url,
				price_text: gift.price_text,
				bought: !!gift.bought,
				approval: gift.approval
			})),
		spendLimit: season.spend_limit,
		hasHelper: effectiveApprovers(recipient.id, viewer.profile.id).length > 0,
		questions: threads.filter((thread) => thread.kind === 'question').slice(0, 5)
	};
};

function context(locals: App.Locals) {
	const viewer = requireViewer(locals);
	const season = currentSeason();
	if (!season) throw error(409, 'There is no season running right now.');
	return { viewer, season };
}

export const actions: Actions = {
	toggleItem: async ({ request, locals }) => {
		const { viewer, season } = context(locals);
		const form = await request.formData();
		const bought = form.get('bought') === '1';
		if (!setItemBought(season.id, viewer.profile.id, Number(form.get('item')), bought)) {
			return fail(404, { message: 'That wish is no longer on their list.', kind: 'bad' });
		}
		return { message: bought ? 'Marked as bought. Nice work!' : 'Unmarked.', kind: 'good' };
	},

	giftBought: async ({ request, locals }) => {
		const { viewer, season } = context(locals);
		const form = await request.formData();
		const bought = form.get('bought') === '1';
		if (!setGiftBought(season.id, viewer.profile.id, String(form.get('gift')), bought)) {
			return fail(404, { message: 'That gift could not be found.', kind: 'bad' });
		}
		return { message: bought ? 'Marked as bought. Nice work!' : 'Unmarked.', kind: 'good' };
	},

	removeGift: async ({ request, locals }) => {
		const { viewer, season } = context(locals);
		const form = await request.formData();
		removeMyGift(season.id, viewer.profile.id, String(form.get('gift')));
		return { message: 'Removed.', kind: 'good' };
	},

	sendQuestion: async ({ request, locals }) => {
		const { viewer, season } = context(locals);
		const form = await request.formData();
		const route = form.get('route') === 'helpers' ? 'helpers' : 'person';
		try {
			askQuestion(season.id, viewer.profile.id, String(form.get('text') ?? ''), route);
		} catch (err) {
			if (err instanceof RelayError) return fail(400, { message: err.message, kind: 'bad' });
			throw err;
		}
		return { message: "Santa's elves have it! It will arrive after a short, random delay, so the timing can't give you away.", kind: 'good' };
	},

	sendSlip: async ({ request, locals }) => {
		const { viewer, season } = context(locals);
		const form = await request.formData();
		const rawUrl = String(form.get('gift_url') ?? '').trim();
		if (rawUrl && !cleanUrl(rawUrl)) {
			return fail(400, { message: "That link doesn't look right. It should start with https://", kind: 'bad' });
		}
		try {
			const outcome = requestApproval(season.id, viewer.profile.id, {
				title: String(form.get('gift') ?? ''),
				url: await resolveRelayUrl(rawUrl),
				price_text: String(form.get('price') ?? ''),
				message: String(form.get('text') ?? '')
			});
			if (outcome.outcome === 'sent') {
				return { message: "Your permission slip is on its way. You'll get a notice when there's an answer.", kind: 'good' };
			}
			return {
				message:
					outcome.reason === 'you_decide'
						? 'You would be the one asked, so this counts as approved.'
						: "Nobody is set up to approve gifts for this person, so Santa marked it approved.",
				kind: 'good'
			};
		} catch (err) {
			if (err instanceof RelayError) return fail(400, { message: err.message, kind: 'bad' });
			throw err;
		}
	},

	logOffList: async ({ request, locals }) => {
		const { viewer, season } = context(locals);
		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();
		if (!title) return fail(400, { message: 'Tell Santa what you bought.', kind: 'bad' });
		const gift = createOffListGift(season.id, viewer.profile.id, { title, bought: true, approval: 'none' });
		if (!gift) return fail(409, { message: 'Open your name first.', kind: 'bad' });
		return { message: 'Logged. Santa saw that, by the way.', kind: 'good' };
	}
};
