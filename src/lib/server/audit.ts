import { db } from './db';

/** Records admin-relevant events. Details must never contain a pairing. */
export function logAudit(actorId: number | null, action: string, detail = ''): void {
	db().prepare('INSERT INTO audit_log (actor_id, action, detail) VALUES (?, ?, ?)').run(actorId, action, detail);
}

/**
 * Events kept only so they can be counted after the season. Their details are only ever a reason
 * code or a number, never anything someone typed. They stay off the dashboard, which would
 * otherwise fill up with them and push the draw and season events out of sight.
 */
export const COUNTED_EVENTS = [
	'login.ok',
	'login.failed',
	'login.throttled',
	'santa.blocked',
	'santa.failed',
	'santa.truncated',
	'list.truncated'
] as const;

export type CountedEvent = (typeof COUNTED_EVENTS)[number];

/** Reason codes for a chat that never reached the model. */
export type SantaBlockReason = 'disabled' | 'budget' | 'unavailable' | 'daily_cap' | 'busy';

/** Anyone on the internet can make a login fail, so each of these events is written at most this often a day. */
export const UNSIGNED_EVENT_DAILY_CAP = 200;
const unsignedCounts = new Map<string, { day: string; count: number }>();

/** For events a stranger can trigger without signing in. Past the daily cap they go uncounted. */
export function logUnsignedEvent(action: 'login.failed' | 'login.throttled'): void {
	const day = new Date().toISOString().slice(0, 10);
	const entry = unsignedCounts.get(action);
	if (!entry || entry.day !== day) {
		unsignedCounts.set(action, { day, count: 1 });
	} else if (entry.count >= UNSIGNED_EVENT_DAILY_CAP) {
		return;
	} else {
		entry.count++;
	}
	logAudit(null, action);
}

export function resetUnsignedEventCountsForTests(): void {
	unsignedCounts.clear();
}

export interface AuditEntry {
	id: number;
	at: string;
	actor_name: string | null;
	action: string;
	detail: string;
}

export function recentAudit(limit = 50): AuditEntry[] {
	const hidden = COUNTED_EVENTS.map(() => '?').join(', ');
	return db()
		.prepare(
			`SELECT a.id, a.at, p.display_name AS actor_name, a.action, a.detail
			 FROM audit_log a LEFT JOIN people p ON p.id = a.actor_id
			 WHERE a.action NOT IN (${hidden})
			 ORDER BY a.id DESC LIMIT ?`
		)
		.all(...COUNTED_EVENTS, limit) as AuditEntry[];
}
