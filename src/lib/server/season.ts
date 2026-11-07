import { db, nowIso, tx } from './db';
import { listPeople } from './people';
import { setSetting } from './settings';

export type SeasonStatus = 'setup' | 'sealed' | 'revealed' | 'archived';

export interface Season {
	id: number;
	name: string;
	status: SeasonStatus;
	spend_limit: string;
	house_rules: string;
	draw_opens_at: string | null;
	rule_guardian: number;
	rule_household: number;
	rule_no_reciprocal: number;
	rule_no_repeat: number;
	sealed_at: string | null;
	revealed_at: string | null;
	emergency_reveals: number;
	created_at: string;
}

export interface PairRule {
	id: number;
	giver_id: number;
	receiver_id: number;
	both_ways: number;
	note: string;
	giver_name: string;
	receiver_name: string;
}

export const DEFAULT_HOUSE_RULES = `Buy from the list. If you want to buy something that is not on your person's list, ask for approval first. Santa will pass the question to their parent or spouse without saying who asked.
Keep your draw secret, including from your own household.
Finish your list by the list deadline, so your Santa has time to shop.`;

export function currentSeason(): Season | null {
	return (
		(db()
			.prepare(`SELECT * FROM seasons WHERE status != 'archived' ORDER BY id DESC LIMIT 1`)
			.get() as Season | undefined) ?? null
	);
}

export function getSeason(id: number): Season | null {
	return (db().prepare('SELECT * FROM seasons WHERE id = ?').get(id) as Season | undefined) ?? null;
}

export function listSeasons(): Season[] {
	return db().prepare('SELECT * FROM seasons ORDER BY id DESC').all() as Season[];
}

export function createSeason(name: string): Season {
	return tx(() => {
		const info = db()
			.prepare('INSERT INTO seasons (name, house_rules) VALUES (?, ?)')
			.run(name.trim(), DEFAULT_HOUSE_RULES);
		const id = Number(info.lastInsertRowid);
		const add = db().prepare('INSERT INTO season_participants (season_id, person_id) VALUES (?, ?)');
		for (const person of listPeople()) add.run(id, person.id);
		// The AI budget is per season, so a new one can warn again when it runs out.
		setSetting('ai_budget_warned', '0');
		return getSeason(id)!;
	});
}

export function updateSeason(
	id: number,
	fields: Partial<
		Pick<
			Season,
			| 'name'
			| 'spend_limit'
			| 'house_rules'
			| 'draw_opens_at'
			| 'rule_guardian'
			| 'rule_household'
			| 'rule_no_reciprocal'
			| 'rule_no_repeat'
		>
	>
): void {
	const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
	if (!entries.length) return;
	const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
	db()
		.prepare(`UPDATE seasons SET ${assignments} WHERE id = ?`)
		.run(...entries.map(([, value]) => value), id);
}

export function setSeasonStatus(id: number, status: SeasonStatus): void {
	const stamp = status === 'sealed' ? ', sealed_at = @now' : status === 'revealed' ? ', revealed_at = @now' : '';
	db()
		.prepare(`UPDATE seasons SET status = @status ${stamp} WHERE id = @id`)
		.run({ status, id, ...(stamp ? { now: nowIso() } : {}) });
}

export function participantIds(seasonId: number): number[] {
	return (
		db()
			.prepare(
				`SELECT sp.person_id AS id FROM season_participants sp
				 JOIN people p ON p.id = sp.person_id
				 WHERE sp.season_id = ? AND p.active = 1`
			)
			.all(seasonId) as { id: number }[]
	).map((row) => row.id);
}

export function isParticipant(seasonId: number, personId: number): boolean {
	return !!db()
		.prepare('SELECT 1 FROM season_participants WHERE season_id = ? AND person_id = ?')
		.get(seasonId, personId);
}

export function setParticipant(seasonId: number, personId: number, included: boolean): void {
	if (included) {
		db()
			.prepare('INSERT OR IGNORE INTO season_participants (season_id, person_id) VALUES (?, ?)')
			.run(seasonId, personId);
	} else {
		db().prepare('DELETE FROM season_participants WHERE season_id = ? AND person_id = ?').run(seasonId, personId);
	}
}

export function setParticipants(seasonId: number, personIds: number[]): void {
	tx(() => {
		db().prepare('DELETE FROM season_participants WHERE season_id = ?').run(seasonId);
		const add = db().prepare('INSERT INTO season_participants (season_id, person_id) VALUES (?, ?)');
		for (const id of new Set(personIds)) add.run(seasonId, id);
	});
}

export function listPairRules(seasonId: number): PairRule[] {
	return db()
		.prepare(
			`SELECT r.id, r.giver_id, r.receiver_id, r.both_ways, r.note,
			        g.display_name AS giver_name, h.display_name AS receiver_name
			 FROM pair_rules r
			 JOIN people g ON g.id = r.giver_id
			 JOIN people h ON h.id = r.receiver_id
			 WHERE r.season_id = ? ORDER BY r.id`
		)
		.all(seasonId) as PairRule[];
}

export function addPairRule(
	seasonId: number,
	giverId: number,
	receiverId: number,
	bothWays: boolean,
	note: string
): void {
	db()
		.prepare('INSERT INTO pair_rules (season_id, giver_id, receiver_id, both_ways, note) VALUES (?, ?, ?, ?, ?)')
		.run(seasonId, giverId, receiverId, bothWays ? 1 : 0, note.trim());
}

export function removePairRule(seasonId: number, ruleId: number): void {
	db().prepare('DELETE FROM pair_rules WHERE id = ? AND season_id = ?').run(ruleId, seasonId);
}
