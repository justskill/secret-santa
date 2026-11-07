import { randomId } from './crypto';
import { db, nowIso, tx } from './db';
import { giverTag, myRecipient } from './draw';
import { participantIds } from './season';
import { getItem } from './wishlist';

export type ApprovalState = 'not_needed' | 'none' | 'waiting' | 'approved' | 'declined';

export interface Gift {
	id: string;
	season_id: number;
	giver_tag: string;
	subject_id: number;
	wish_item_id: number | null;
	title: string;
	url: string | null;
	price_text: string | null;
	off_list: number;
	bought: number;
	approval: ApprovalState;
	created_at: string;
	updated_at: string;
}

/** The gifts this profile is tracking for the person they currently have. */
export function myGifts(seasonId: number, profileId: number): Gift[] {
	const recipient = myRecipient(seasonId, profileId);
	if (!recipient) return [];
	return db()
		.prepare('SELECT * FROM gifts WHERE season_id = ? AND giver_tag = ? AND subject_id = ? ORDER BY created_at')
		.all(seasonId, giverTag(seasonId, profileId), recipient.id) as Gift[];
}

export function getMyGift(seasonId: number, profileId: number, giftId: string): Gift | null {
	return (
		(db()
			.prepare('SELECT * FROM gifts WHERE id = ? AND season_id = ? AND giver_tag = ?')
			.get(giftId, seasonId, giverTag(seasonId, profileId)) as Gift | undefined) ?? null
	);
}

/** Marks an item from their person's list as bought or not bought. */
export function setItemBought(seasonId: number, profileId: number, itemId: number, bought: boolean): boolean {
	const recipient = myRecipient(seasonId, profileId);
	const item = getItem(itemId);
	if (!recipient || !item || item.person_id !== recipient.id || item.season_id !== seasonId) return false;
	const tag = giverTag(seasonId, profileId);
	tx(() => {
		const existing = db()
			.prepare('SELECT id FROM gifts WHERE season_id = ? AND giver_tag = ? AND wish_item_id = ?')
			.get(seasonId, tag, itemId) as { id: string } | undefined;
		if (bought && !existing) {
			db()
				.prepare(
					`INSERT INTO gifts (id, season_id, giver_tag, subject_id, wish_item_id, title, url, price_text, bought)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
				)
				.run(randomId(), seasonId, tag, recipient.id, itemId, item.title, item.url, item.price_text);
		} else if (!bought && existing) {
			db().prepare('DELETE FROM gifts WHERE id = ?').run(existing.id);
		}
	});
	return true;
}

/** Records an off-list gift. Approval is requested separately through a permission slip. */
export function createOffListGift(
	seasonId: number,
	profileId: number,
	input: { title: string; url?: string | null; price_text?: string | null; approval?: ApprovalState; bought?: boolean }
): Gift | null {
	const recipient = myRecipient(seasonId, profileId);
	if (!recipient) return null;
	const id = randomId();
	db()
		.prepare(
			`INSERT INTO gifts (id, season_id, giver_tag, subject_id, title, url, price_text, off_list, bought, approval)
			 VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
		)
		.run(
			id,
			seasonId,
			giverTag(seasonId, profileId),
			recipient.id,
			input.title.trim().slice(0, 200),
			input.url ?? null,
			input.price_text?.trim().slice(0, 40) || null,
			input.bought ? 1 : 0,
			input.approval ?? 'none'
		);
	return getMyGift(seasonId, profileId, id);
}

export function setGiftBought(seasonId: number, profileId: number, giftId: string, bought: boolean): boolean {
	const result = db()
		.prepare('UPDATE gifts SET bought = ?, updated_at = ? WHERE id = ? AND season_id = ? AND giver_tag = ?')
		.run(bought ? 1 : 0, nowIso(), giftId, seasonId, giverTag(seasonId, profileId));
	return result.changes > 0;
}

export function removeMyGift(seasonId: number, profileId: number, giftId: string): boolean {
	return (
		db()
			.prepare('DELETE FROM gifts WHERE id = ? AND season_id = ? AND giver_tag = ?')
			.run(giftId, seasonId, giverTag(seasonId, profileId)).changes > 0
	);
}

export function setGiftApproval(giftId: string, approval: ApprovalState): void {
	db().prepare('UPDATE gifts SET approval = ?, updated_at = ? WHERE id = ?').run(approval, nowIso(), giftId);
}

/** Wish items that have been bought. Reveals what is covered, never by whom. */
export function coveredItemIds(seasonId: number, ownerId: number): number[] {
	return (
		db()
			.prepare(
				`SELECT DISTINCT wish_item_id AS id FROM gifts
				 WHERE season_id = ? AND subject_id = ? AND bought = 1 AND wish_item_id IS NOT NULL`
			)
			.all(seasonId, ownerId) as { id: number }[]
	).map((row) => row.id);
}

export function peopleWithNoGift(seasonId: number): number[] {
	const tagsWithGift = new Set(
		(
			db()
				.prepare('SELECT DISTINCT giver_tag AS tag FROM gifts WHERE season_id = ? AND bought = 1')
				.all(seasonId) as { tag: string }[]
		).map((row) => row.tag)
	);
	return participantIds(seasonId).filter((id) => !tagsWithGift.has(giverTag(seasonId, id)));
}

export interface OffListStats {
	asked: number;
	approved: number;
	declined: number;
	boughtWithoutAsking: number;
}

/** Totals for reveal day. Counts only, with no names, because this is meant to be fun. */
export function offListStats(seasonId: number): OffListStats {
	return db()
		.prepare(
			`SELECT
				COALESCE(SUM(CASE WHEN approval IN ('waiting', 'approved', 'declined') THEN 1 ELSE 0 END), 0) AS asked,
				COALESCE(SUM(CASE WHEN approval = 'approved' THEN 1 ELSE 0 END), 0) AS approved,
				COALESCE(SUM(CASE WHEN approval = 'declined' THEN 1 ELSE 0 END), 0) AS declined,
				COALESCE(SUM(CASE WHEN approval = 'none' AND bought = 1 THEN 1 ELSE 0 END), 0) AS boughtWithoutAsking
			 FROM gifts WHERE season_id = ? AND off_list = 1`
		)
		.get(seasonId) as OffListStats;
}

/** Everyone who asked before buying off-list, for the Nice List on reveal day. */
export function niceListTags(seasonId: number): Set<string> {
	return new Set(
		(
			db()
				.prepare(
					`SELECT DISTINCT giver_tag AS tag FROM gifts
					 WHERE season_id = ? AND off_list = 1 AND approval IN ('waiting', 'approved', 'declined')`
				)
				.all(seasonId) as { tag: string }[]
		).map((row) => row.tag)
	);
}
