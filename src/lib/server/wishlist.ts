import { db, nowIso } from './db';
import { myRecipient, notifySantaOf } from './draw';
import { getPerson, firstNameOf, type Person } from './people';
import { parsePublicUrl } from './safefetch';
import type { Season } from './season';
import { listIsLocked } from './countdowns';

export interface WishItem {
	id: number;
	season_id: number;
	person_id: number;
	title: string;
	url: string | null;
	image_url: string | null;
	price_text: string | null;
	notes: string;
	priority: number;
	source: string;
	created_at: string;
	updated_at: string;
}

export interface ListMeta {
	amazon_url: string | null;
	intro_note: string;
	ready_at: string | null;
}

export interface WishItemInput {
	title: string;
	url?: string | null;
	image_url?: string | null;
	price_text?: string | null;
	notes?: string | null;
	priority?: number;
}

export class ListLockedError extends Error {
	constructor() {
		super('The list deadline has passed, so this list is locked.');
	}
}

/** Keeps only web links, so a list item can never carry a script link into someone's browser. */
export function cleanUrl(raw: string | null | undefined): string | null {
	if (!raw?.trim()) return null;
	return parsePublicUrl(raw)?.toString() ?? null;
}

/**
 * Only images already copied to this server are allowed. A remote image would make a Santa's
 * browser contact a server the list's owner could control, showing them who is viewing the list.
 */
function cleanImageUrl(raw: string | null | undefined): string | null {
	return raw && /^\/media\/[a-f0-9]{24}\.(jpg|png|webp)$/.test(raw) ? raw : null;
}

function clampPriority(value: number | undefined): number {
	return value === 1 || value === 3 ? value : 2;
}

function clip(value: string | null | undefined, length: number): string {
	return (value ?? '').trim().slice(0, length);
}

export function listItems(seasonId: number, personId: number): WishItem[] {
	return db()
		.prepare(
			`SELECT * FROM wish_items WHERE season_id = ? AND person_id = ? AND deleted_at IS NULL
			 ORDER BY priority ASC, id ASC`
		)
		.all(seasonId, personId) as WishItem[];
}

export function getItem(itemId: number): WishItem | null {
	return (
		(db().prepare('SELECT * FROM wish_items WHERE id = ? AND deleted_at IS NULL').get(itemId) as
			| WishItem
			| undefined) ?? null
	);
}

export function getListMeta(seasonId: number, personId: number): ListMeta {
	const row = db()
		.prepare('SELECT amazon_url, intro_note, ready_at FROM list_meta WHERE season_id = ? AND person_id = ?')
		.get(seasonId, personId) as ListMeta | undefined;
	return row ?? { amazon_url: null, intro_note: '', ready_at: null };
}

function ensureMeta(seasonId: number, personId: number): void {
	db()
		.prepare('INSERT OR IGNORE INTO list_meta (season_id, person_id) VALUES (?, ?)')
		.run(seasonId, personId);
}

function assertUnlocked(season: Season): void {
	if (listIsLocked(season.id)) throw new ListLockedError();
}

function notifyNewItem(seasonId: number, personId: number): void {
	const meta = getListMeta(seasonId, personId);
	if (!meta.ready_at) return;
	const row = db()
		.prepare('SELECT update_notified_at AS at FROM list_meta WHERE season_id = ? AND person_id = ?')
		.get(seasonId, personId) as { at: string | null } | undefined;
	if (row?.at && Date.now() - new Date(row.at).getTime() < 12 * 3_600_000) return;
	db()
		.prepare('UPDATE list_meta SET update_notified_at = ? WHERE season_id = ? AND person_id = ?')
		.run(nowIso(), seasonId, personId);
	const person = getPerson(personId);
	notifySantaOf(seasonId, personId, {
		title: `${firstNameOf(person?.display_name ?? 'Your person')} added to their list`,
		body: 'Your person added something new since the list was marked ready.',
		link: '/my-person'
	});
}

export function addItem(season: Season, personId: number, input: WishItemInput, source = 'manual'): WishItem {
	assertUnlocked(season);
	const title = clip(input.title, 200);
	if (!title) throw new Error('A wish needs a name.');
	const info = db()
		.prepare(
			`INSERT INTO wish_items (season_id, person_id, title, url, image_url, price_text, notes, priority, source)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			season.id,
			personId,
			title,
			cleanUrl(input.url),
			cleanImageUrl(input.image_url),
			clip(input.price_text, 40) || null,
			clip(input.notes, 600),
			clampPriority(input.priority),
			source
		);
	notifyNewItem(season.id, personId);
	return getItem(Number(info.lastInsertRowid))!;
}

export function updateItem(season: Season, personId: number, itemId: number, input: Partial<WishItemInput>): boolean {
	assertUnlocked(season);
	const item = getItem(itemId);
	if (!item || item.person_id !== personId || item.season_id !== season.id) return false;
	db()
		.prepare(
			`UPDATE wish_items SET title = ?, url = ?, image_url = ?, price_text = ?, notes = ?, priority = ?, updated_at = ?
			 WHERE id = ?`
		)
		.run(
			input.title === undefined ? item.title : clip(input.title, 200) || item.title,
			input.url === undefined ? item.url : cleanUrl(input.url),
			input.image_url === undefined ? item.image_url : cleanImageUrl(input.image_url),
			input.price_text === undefined ? item.price_text : clip(input.price_text, 40) || null,
			input.notes === undefined ? item.notes : clip(input.notes, 600),
			input.priority === undefined ? item.priority : clampPriority(input.priority),
			nowIso(),
			itemId
		);
	return true;
}

export function removeItem(season: Season, personId: number, itemId: number): boolean {
	assertUnlocked(season);
	const result = db()
		.prepare('UPDATE wish_items SET deleted_at = ? WHERE id = ? AND person_id = ? AND season_id = ? AND deleted_at IS NULL')
		.run(nowIso(), itemId, personId, season.id);
	return result.changes > 0;
}

export function setAmazonUrl(season: Season, personId: number, url: string | null): void {
	assertUnlocked(season);
	ensureMeta(season.id, personId);
	db()
		.prepare('UPDATE list_meta SET amazon_url = ? WHERE season_id = ? AND person_id = ?')
		.run(cleanUrl(url), season.id, personId);
}

export function setIntroNote(season: Season, personId: number, note: string): void {
	assertUnlocked(season);
	ensureMeta(season.id, personId);
	db()
		.prepare('UPDATE list_meta SET intro_note = ? WHERE season_id = ? AND person_id = ?')
		.run(clip(note, 600), season.id, personId);
}

export function setListReady(season: Season, person: Person, ready: boolean): void {
	assertUnlocked(season);
	ensureMeta(season.id, person.id);
	db()
		.prepare('UPDATE list_meta SET ready_at = ? WHERE season_id = ? AND person_id = ?')
		.run(ready ? nowIso() : null, season.id, person.id);
	if (ready) {
		notifySantaOf(season.id, person.id, {
			title: `${firstNameOf(person.display_name)}'s list is ready`,
			body: 'Your person marked their wish list as ready. Happy shopping!',
			link: '/my-person'
		});
	}
}

export function peopleWithListNotReady(seasonId: number, participantIds: number[]): number[] {
	const ready = new Set(
		(
			db()
				.prepare('SELECT person_id AS id FROM list_meta WHERE season_id = ? AND ready_at IS NOT NULL')
				.all(seasonId) as { id: number }[]
		).map((row) => row.id)
	);
	return participantIds.filter((id) => !ready.has(id));
}

/* ---- Who may read a list ---- */

/**
 * A list is visible to its owner (including a parent acting as that kid) and to whoever drew them.
 * Everyone else is refused, so there is no way to browse a list you were not given.
 */
export function canViewList(seasonId: number, profileId: number, ownerId: number): boolean {
	if (profileId === ownerId) return true;
	return myRecipient(seasonId, profileId)?.id === ownerId;
}

/* ---- Standing guidance ---- */

export interface Guidance {
	notes: string;
	helper_notes: string;
}

export function getGuidance(personId: number): Guidance {
	const row = db().prepare('SELECT notes, helper_notes FROM guidance WHERE person_id = ?').get(personId) as
		| Guidance
		| undefined;
	return row ?? { notes: '', helper_notes: '' };
}

export function setGuidance(personId: number, fields: Partial<Guidance>): void {
	const current = getGuidance(personId);
	db()
		.prepare(
			`INSERT INTO guidance (person_id, notes, helper_notes, updated_at) VALUES (?, ?, ?, ?)
			 ON CONFLICT (person_id) DO UPDATE SET notes = excluded.notes, helper_notes = excluded.helper_notes, updated_at = excluded.updated_at`
		)
		.run(
			personId,
			fields.notes === undefined ? current.notes : clip(fields.notes, 1500),
			fields.helper_notes === undefined ? current.helper_notes : clip(fields.helper_notes, 1500),
			nowIso()
		);
}
