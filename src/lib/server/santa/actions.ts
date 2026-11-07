import { randomId, seal, unseal } from '../crypto';
import { db, nowIso } from '../db';
import { myRecipient } from '../draw';
import { createOffListGift, setGiftBought, setItemBought } from '../gifts';
import type { Person } from '../people';
import { getSeason, type Season } from '../season';
import {
	askQuestion,
	decideApproval,
	followUpFromBuyer,
	replyToBuyer,
	requestApproval,
	RelayError,
	type ThreadRoute
} from '../threads';
import {
	addItem,
	ListLockedError,
	removeItem,
	setListReady,
	updateItem,
	type WishItemInput
} from '../wishlist';

/**
 * Anything Santa wants to change starts as a pending action shown as a card. Only a person's tap
 * runs it, and it re-checks permissions at that moment, so nothing in a chat can act alone.
 */

export type ActionPayload =
	| { kind: 'add_items'; items: WishItemInput[] }
	| { kind: 'remove_item'; itemId: number; title: string }
	| { kind: 'update_item'; itemId: number; title: string; changes: Partial<WishItemInput> }
	| { kind: 'list_ready'; ready: boolean }
	| { kind: 'send_question'; route: ThreadRoute; subjectId: number; text: string }
	| { kind: 'permission_slip'; subjectId: number; gift: string; price: string | null; url: string | null; text: string }
	| { kind: 'follow_up'; threadId: string; text: string }
	| { kind: 'reply'; threadId: string; text: string }
	| { kind: 'decide_slip'; threadId: string; approved: boolean; note: string }
	| { kind: 'item_bought'; itemId: number; title: string; bought: boolean }
	| { kind: 'gift_bought'; giftId: string; title: string; bought: boolean }
	| { kind: 'log_off_list_bought'; title: string; price: string | null; url: string | null };

export interface ActionCard {
	id: string;
	kind: ActionPayload['kind'];
	title: string;
	body: string;
	bullets: string[];
	notes: string[];
	confirmLabel: string;
	cancelLabel: string;
	/** True when the person can edit the wording before it goes. */
	editable: boolean;
	status: 'pending' | 'confirmed' | 'cancelled' | 'failed';
	result: string | null;
}

interface SealedAction {
	payload: ActionPayload;
	card: Omit<ActionCard, 'id' | 'status' | 'result' | 'kind'>;
	result: string | null;
}

interface ActionRow {
	id: string;
	season_id: number;
	person_id: number;
	kind: string;
	sealed: string;
	status: ActionCard['status'];
}

function toCard(row: ActionRow): ActionCard {
	const data = unseal<SealedAction>(row.sealed);
	return {
		id: row.id,
		kind: data.payload.kind,
		status: row.status,
		result: data.result,
		...data.card
	};
}

export function createAction(
	seasonId: number,
	personId: number,
	payload: ActionPayload,
	card: SealedAction['card']
): ActionCard {
	const id = randomId(20);
	const sealed = seal({ payload, card, result: null } satisfies SealedAction);
	db()
		.prepare('INSERT INTO pending_actions (id, season_id, person_id, kind, sealed) VALUES (?, ?, ?, ?, ?)')
		// The real kind stays inside the sealed payload, so this table doesn't show who asked what, when.
		.run(id, seasonId, personId, 'card', sealed);
	return toCard({ id, season_id: seasonId, person_id: personId, kind: 'card', sealed, status: 'pending' });
}

export function actionCards(ids: string[], personId: number): ActionCard[] {
	if (!ids.length) return [];
	const rows = db()
		.prepare(`SELECT * FROM pending_actions WHERE person_id = ? AND id IN (${ids.map(() => '?').join(',')})`)
		.all(personId, ...ids) as ActionRow[];
	const byId = new Map(rows.map((row) => [row.id, toCard(row)]));
	return ids.map((id) => byId.get(id)).filter((card): card is ActionCard => !!card);
}

/** A card written about one person must not go out about someone else if the draw changed since. */
function requireSameRecipient(season: Season, profile: Person, subjectId: number): void {
	if (myRecipient(season.id, profile.id)?.id !== subjectId) {
		throw new RelayError('Your name changed since Santa wrote this, so this card no longer applies.');
	}
}

function perform(season: Season, profile: Person, payload: ActionPayload): string {
	switch (payload.kind) {
		case 'add_items': {
			for (const item of payload.items) addItem(season, profile.id, item, 'santa');
			const count = payload.items.length;
			return `Added ${count} ${count === 1 ? 'wish' : 'wishes'} to the list.`;
		}
		case 'remove_item': {
			if (!removeItem(season, profile.id, payload.itemId)) throw new RelayError('That wish is already gone.');
			return `Removed "${payload.title}" from the list.`;
		}
		case 'update_item': {
			if (!updateItem(season, profile.id, payload.itemId, payload.changes)) {
				throw new RelayError('That wish could not be found.');
			}
			return `Updated "${payload.title}".`;
		}
		case 'list_ready': {
			setListReady(season, profile, payload.ready);
			return payload.ready ? 'The list is marked ready.' : 'The list is open for more changes.';
		}
		case 'send_question': {
			requireSameRecipient(season, profile, payload.subjectId);
			askQuestion(season.id, profile.id, payload.text, payload.route);
			return "Santa's elves have it. It will arrive after a short, random delay so the timing can't give you away.";
		}
		case 'permission_slip': {
			requireSameRecipient(season, profile, payload.subjectId);
			const outcome = requestApproval(season.id, profile.id, {
				title: payload.gift,
				url: payload.url,
				price_text: payload.price,
				message: payload.text
			});
			if (outcome.outcome === 'sent') {
				return 'The permission slip is on its way. It is tracked on your My Person page.';
			}
			return outcome.reason === 'you_decide'
				? 'You would be the one asked, so this counts as approved.'
				: 'Nobody is set up to approve gifts for this person, so Santa marked it approved. It is tracked on your My Person page.';
		}
		case 'follow_up': {
			followUpFromBuyer(payload.threadId, profile.id, payload.text);
			return 'Your follow-up is on its way.';
		}
		case 'reply': {
			replyToBuyer(payload.threadId, profile.id, payload.text);
			return 'Santa passed along your answer.';
		}
		case 'decide_slip': {
			decideApproval(payload.threadId, profile.id, payload.approved, payload.note);
			return payload.approved ? 'Approved. Santa passed it along.' : 'Declined. Santa passed it along.';
		}
		case 'item_bought': {
			if (!setItemBought(season.id, profile.id, payload.itemId, payload.bought)) {
				throw new RelayError('That wish could not be found on their list.');
			}
			return payload.bought ? `Marked "${payload.title}" as bought.` : `Unmarked "${payload.title}".`;
		}
		case 'gift_bought': {
			if (!setGiftBought(season.id, profile.id, payload.giftId, payload.bought)) {
				throw new RelayError('That gift could not be found.');
			}
			return payload.bought ? `Marked "${payload.title}" as bought.` : `Unmarked "${payload.title}".`;
		}
		case 'log_off_list_bought': {
			const gift = createOffListGift(season.id, profile.id, {
				title: payload.title,
				url: payload.url,
				price_text: payload.price,
				bought: true,
				approval: 'none'
			});
			if (!gift) throw new RelayError('Open your name first, so Santa knows who this is for.');
			return `Logged "${payload.title}" as bought without a permission slip.`;
		}
	}
}

export type DecisionResult = { ok: true; card: ActionCard; event: string } | { ok: false; status: number; message: string };

/** Runs or cancels a card. Only the profile that the card belongs to can do this. */
export function decideAction(
	actionId: string,
	profile: Person,
	decision: 'confirm' | 'cancel',
	editedText?: string
): DecisionResult {
	const row = db()
		.prepare('SELECT * FROM pending_actions WHERE id = ? AND person_id = ?')
		.get(actionId, profile.id) as ActionRow | undefined;
	if (!row) return { ok: false, status: 404, message: 'Santa could not find that card.' };
	if (row.status !== 'pending') return { ok: false, status: 409, message: 'This card has already been used.' };

	const season = getSeason(row.season_id);
	if (!season) return { ok: false, status: 404, message: 'That season is gone.' };

	const data = unseal<SealedAction>(row.sealed);

	const save = (status: ActionCard['status'], result: string, card = data.card): ActionCard => {
		const sealed = seal({ ...data, card, result } satisfies SealedAction);
		db()
			.prepare('UPDATE pending_actions SET status = ?, sealed = ?, decided_at = ? WHERE id = ?')
			.run(status, sealed, nowIso(), row.id);
		return toCard({ ...row, sealed, status });
	};

	if (decision === 'cancel') {
		return { ok: true, card: save('cancelled', 'Cancelled.'), event: `The person cancelled the card: ${data.card.title}.` };
	}

	const payload = { ...data.payload } as ActionPayload;
	let card = data.card;
	if (editedText !== undefined && data.card.editable) {
		const text = editedText.trim();
		if (!text) return { ok: false, status: 400, message: 'The message is empty.' };
		if ('text' in payload) payload.text = text;
		card = { ...card, body: text };
	}

	try {
		const result = perform(season, profile, payload);
		return { ok: true, card: save('confirmed', result, card), event: `The person confirmed the card: ${data.card.title}. Result: ${result}` };
	} catch (err) {
		const known = err instanceof RelayError || err instanceof ListLockedError;
		const message = known ? (err as Error).message : 'Something went wrong in the workshop.';
		if (!known) console.error('Santa action failed:', err);
		return { ok: true, card: save('failed', message, card), event: `The card "${data.card.title}" failed: ${message}` };
	}
}
