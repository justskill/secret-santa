import { seal, unseal } from './crypto';
import { db, tx } from './db';

export type NoticeKind = 'info' | 'mail' | 'draw' | 'deadline' | 'list' | 'reminder' | 'alert' | 'party';

export interface Notice {
	id: number;
	season_id: number | null;
	person_id: number | null;
	kind: NoticeKind;
	title: string;
	body: string;
	link: string | null;
	created_at: string;
	read: number;
}

/**
 * Titles and bodies are sealed, because a notice like "Morgan's list is ready" sent to the person
 * who drew Morgan would otherwise show a pairing to anyone browsing the database or a backup.
 */
function opened<T extends { title: string; body: string }>(row: T): T {
	return { ...row, title: unseal<string>(row.title), body: unseal<string>(row.body) };
}

export function postNotice(input: {
	seasonId?: number | null;
	personId?: number | null;
	kind?: NoticeKind;
	title: string;
	body?: string;
	link?: string | null;
}): number {
	const info = db()
		.prepare('INSERT INTO notices (season_id, person_id, kind, title, body, link) VALUES (?, ?, ?, ?, ?, ?)')
		.run(
			input.seasonId ?? null,
			input.personId ?? null,
			input.kind ?? 'info',
			seal(input.title),
			seal(input.body ?? ''),
			input.link ?? null
		);
	return Number(info.lastInsertRowid);
}

const VISIBLE_TO = `(n.person_id = @person OR n.person_id IS NULL)`;

export function noticesFor(personId: number, limit = 50): Notice[] {
	const rows = db()
		.prepare(
			`SELECT n.*, CASE WHEN r.notice_id IS NULL THEN 0 ELSE 1 END AS read
			 FROM notices n
			 LEFT JOIN notice_reads r ON r.notice_id = n.id AND r.person_id = @person
			 WHERE ${VISIBLE_TO}
			 ORDER BY n.id DESC LIMIT @limit`
		)
		.all({ person: personId, limit }) as Notice[];
	return rows.map(opened);
}

/**
 * Unread notices, not counting mail alerts. Mail is counted by what still needs an answer, which
 * keeps it up after being read, and stops one message from counting as both a notice and mail.
 */
export function unreadCount(personId: number): number {
	return (
		db()
			.prepare(
				`SELECT COUNT(*) AS n FROM notices n
				 LEFT JOIN notice_reads r ON r.notice_id = n.id AND r.person_id = @person
				 WHERE ${VISIBLE_TO} AND r.notice_id IS NULL AND n.kind != 'mail'`
			)
			.get({ person: personId }) as { n: number }
	).n;
}

/** Counts only notices addressed to this person, so a family-wide post does not badge every kid. */
export function unreadPersonalCount(personId: number): number {
	return (
		db()
			.prepare(
				`SELECT COUNT(*) AS n FROM notices n
				 LEFT JOIN notice_reads r ON r.notice_id = n.id AND r.person_id = ?
				 WHERE n.person_id = ? AND r.notice_id IS NULL AND n.kind != 'mail'`
			)
			.get(personId, personId) as { n: number }
	).n;
}

export function markAllRead(personId: number): void {
	const unread = db()
		.prepare(
			`SELECT n.id FROM notices n
			 LEFT JOIN notice_reads r ON r.notice_id = n.id AND r.person_id = @person
			 WHERE ${VISIBLE_TO} AND r.notice_id IS NULL`
		)
		.all({ person: personId }) as { id: number }[];
	tx(() => {
		const insert = db().prepare('INSERT OR IGNORE INTO notice_reads (notice_id, person_id) VALUES (?, ?)');
		for (const row of unread) insert.run(row.id, personId);
	});
}

/**
 * Only announcements the admin wrote can be removed. Notices the system posts, such as the alert
 * about an emergency reveal, must stay where the family can see them.
 */
export function deleteAnnouncement(noticeId: number): boolean {
	return (
		db().prepare(`DELETE FROM notices WHERE id = ? AND person_id IS NULL AND kind = 'info'`).run(noticeId).changes > 0
	);
}

export function familyAnnouncements(limit = 30): Omit<Notice, 'read'>[] {
	const rows = db()
		.prepare(`SELECT * FROM notices WHERE person_id IS NULL AND kind = 'info' ORDER BY id DESC LIMIT ?`)
		.all(limit) as Omit<Notice, 'read'>[];
	return rows.map(opened);
}
