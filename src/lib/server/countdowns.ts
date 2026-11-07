import { db, nowIso } from './db';

export interface Countdown {
	id: number;
	season_id: number;
	title: string;
	subtitle: string;
	target_at: string;
	kind: 'list_deadline' | 'exchange' | 'custom';
	hard_lock: number;
	visible: number;
	passed_at: string | null;
	created_at: string;
}

export function listCountdowns(seasonId: number): Countdown[] {
	return db()
		.prepare('SELECT * FROM countdowns WHERE season_id = ? ORDER BY target_at ASC')
		.all(seasonId) as Countdown[];
}

export function visibleCountdowns(seasonId: number): Countdown[] {
	return listCountdowns(seasonId).filter((c) => c.visible);
}

export function getCountdown(id: number): Countdown | null {
	return (db().prepare('SELECT * FROM countdowns WHERE id = ?').get(id) as Countdown | undefined) ?? null;
}

export interface CountdownInput {
	title: string;
	subtitle?: string;
	target_at: string;
	kind: Countdown['kind'];
	hard_lock?: boolean;
	visible?: boolean;
}

export function createCountdown(seasonId: number, input: CountdownInput): number {
	const info = db()
		.prepare(
			`INSERT INTO countdowns (season_id, title, subtitle, target_at, kind, hard_lock, visible)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			seasonId,
			input.title.trim(),
			input.subtitle?.trim() ?? '',
			input.target_at,
			input.kind,
			input.hard_lock ? 1 : 0,
			input.visible === false ? 0 : 1
		);
	return Number(info.lastInsertRowid);
}

export function updateCountdown(id: number, input: CountdownInput): void {
	const stillFuture = input.target_at > nowIso();
	db()
		.prepare(
			`UPDATE countdowns SET title = ?, subtitle = ?, target_at = ?, kind = ?, hard_lock = ?, visible = ?,
			 passed_at = CASE WHEN ? THEN NULL ELSE passed_at END WHERE id = ?`
		)
		.run(
			input.title.trim(),
			input.subtitle?.trim() ?? '',
			input.target_at,
			input.kind,
			input.hard_lock ? 1 : 0,
			input.visible === false ? 0 : 1,
			stillFuture ? 1 : 0,
			id
		);
}

export function deleteCountdown(id: number): void {
	db().prepare('DELETE FROM countdowns WHERE id = ?').run(id);
}

export function listDeadline(seasonId: number): Countdown | null {
	return (
		(db()
			.prepare(`SELECT * FROM countdowns WHERE season_id = ? AND kind = 'list_deadline' ORDER BY target_at LIMIT 1`)
			.get(seasonId) as Countdown | undefined) ?? null
	);
}

export function exchangeDay(seasonId: number): Countdown | null {
	return (
		(db()
			.prepare(`SELECT * FROM countdowns WHERE season_id = ? AND kind = 'exchange' ORDER BY target_at LIMIT 1`)
			.get(seasonId) as Countdown | undefined) ?? null
	);
}

/** True once a list deadline set to lock has passed. */
export function listIsLocked(seasonId: number): boolean {
	return !!db()
		.prepare(
			`SELECT 1 FROM countdowns WHERE season_id = ? AND kind = 'list_deadline' AND hard_lock = 1 AND target_at <= ? LIMIT 1`
		)
		.get(seasonId, nowIso());
}

export function dueCountdowns(): Countdown[] {
	return db()
		.prepare(
			`SELECT c.* FROM countdowns c JOIN seasons s ON s.id = c.season_id
			 WHERE c.passed_at IS NULL AND c.target_at <= ? AND s.status != 'archived'`
		)
		.all(nowIso()) as Countdown[];
}

export function markCountdownPassed(id: number): void {
	db().prepare('UPDATE countdowns SET passed_at = ? WHERE id = ?').run(nowIso(), id);
}
