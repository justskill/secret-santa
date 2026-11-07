import { db } from './db';

/** Records admin-relevant events. Details must never contain a pairing. */
export function logAudit(actorId: number | null, action: string, detail = ''): void {
	db().prepare('INSERT INTO audit_log (actor_id, action, detail) VALUES (?, ?, ?)').run(actorId, action, detail);
}

export interface AuditEntry {
	id: number;
	at: string;
	actor_name: string | null;
	action: string;
	detail: string;
}

export function recentAudit(limit = 50): AuditEntry[] {
	return db()
		.prepare(
			`SELECT a.id, a.at, p.display_name AS actor_name, a.action, a.detail
			 FROM audit_log a LEFT JOIN people p ON p.id = a.actor_id
			 ORDER BY a.id DESC LIMIT ?`
		)
		.all(limit) as AuditEntry[];
}
