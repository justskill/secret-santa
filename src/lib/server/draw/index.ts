import { randomBytes } from 'node:crypto';
import { logAudit } from '../audit';
import { blindTag, seal, sha256, unseal } from '../crypto';
import { db, nowIso, tx } from '../db';
import { postNotice } from '../notices';
import { getPerson, listPeople, type Person } from '../people';
import {
	getSeason,
	listPairRules,
	listSeasons,
	participantIds,
	setParticipant,
	setSeasonStatus,
	type Season
} from '../season';
import {
	countArrangements,
	repairAddition,
	repairRemoval,
	solveDraw,
	type DrawProblem,
	type Pairing
} from './solver';

/**
 * Everything that touches who-has-whom lives here. Only two kinds of function leave this module:
 *  - ones that return a profile's own draw, after they have revealed it
 *  - ones that act on a person's Santa (such as notifying them) and return nothing about who that is
 * The full pairing is only returned after the season's results have been published, or through
 * the emergency reveal, which tells the whole family it happened.
 */

interface AssignmentRow {
	giver_id: number;
	receiver_sealed: string;
	revealed_at: string | null;
	changed_at: string | null;
}

/** A new tag each season, so last year's published results can't identify this year's rows. */
export function giverTag(seasonId: number, personId: number): string {
	return blindTag(`giver:${seasonId}`, personId);
}

function loadPairing(seasonId: number): Pairing {
	const rows = db()
		.prepare('SELECT giver_id, receiver_sealed FROM assignments WHERE season_id = ?')
		.all(seasonId) as AssignmentRow[];
	return new Map(rows.map((row) => [row.giver_id, unseal<number>(row.receiver_sealed)]));
}

function previousSeasonPairing(season: Season): Pairing | null {
	const previous = listSeasons().find(
		(s) => s.id < season.id && (s.status === 'sealed' || s.status === 'revealed' || s.status === 'archived')
	);
	return previous ? loadPairing(previous.id) : null;
}

/** Builds the rule set for a season. The same rules apply whenever the pairing changes. */
export function buildProblem(season: Season, people: number[]): DrawProblem {
	const directory = new Map(listPeople({ includeInactive: true }).map((p) => [p.id, p]));
	const blocked = new Set<string>();
	const block = (giver: number, receiver: number) => blocked.add(`${giver}>${receiver}`);

	if (season.rule_guardian) {
		const links = db().prepare('SELECT guardian_id, ward_id FROM guardianships').all() as {
			guardian_id: number;
			ward_id: number;
		}[];
		for (const { guardian_id, ward_id } of links) {
			block(guardian_id, ward_id);
			block(ward_id, guardian_id);
		}
	}

	for (const rule of listPairRules(season.id)) {
		block(rule.giver_id, rule.receiver_id);
		if (rule.both_ways) block(rule.receiver_id, rule.giver_id);
	}

	if (season.rule_no_repeat) {
		const last = previousSeasonPairing(season);
		if (last) for (const [giver, receiver] of last) block(giver, receiver);
	}

	return {
		people,
		noReciprocal: !!season.rule_no_reciprocal,
		forbidden: (giver, receiver) => {
			if (blocked.has(`${giver}>${receiver}`)) return true;
			if (season.rule_household) {
				const a = directory.get(giver)?.household_id;
				const b = directory.get(receiver)?.household_id;
				if (a !== null && a !== undefined && a === b) return true;
			}
			return false;
		}
	};
}

export interface DrawCheck {
	ok: boolean;
	reason?: string;
	stuckNames: string[];
	options: { id: number; name: string; count: number }[];
	/** How many valid arrangements exist. Null when there are too many to count quickly. */
	arrangements: number | null;
}

/** Tests the rules without storing anything, and never reports a specific pairing. */
export function checkDraw(season: Season): DrawCheck {
	const people = participantIds(season.id);
	const problem = buildProblem(season, people);
	const directory = new Map(listPeople({ includeInactive: true }).map((p) => [p.id, p]));
	const name = (id: number) => directory.get(id)?.display_name ?? 'Unknown';
	const options = people
		.map((id) => ({
			id,
			name: name(id),
			count: people.filter((r) => r !== id && !problem.forbidden(id, r)).length
		}))
		.sort((a, b) => a.count - b.count);

	const result = solveDraw(problem);
	if (result.ok) return { ok: true, stuckNames: [], options, arrangements: countArrangements(problem) };
	return { ok: false, reason: result.reason, stuckNames: result.stuck.map(name), options, arrangements: 0 };
}

function writeCommitment(seasonId: number, pairing: Pairing, reason: string, arrangements: number | null = null): string {
	const last = db()
		.prepare('SELECT MAX(version) AS v FROM draw_commitments WHERE season_id = ?')
		.get(seasonId) as { v: number | null };
	const version = (last.v ?? 0) + 1;
	const canonical = JSON.stringify({
		season: seasonId,
		version,
		salt: randomBytes(32).toString('hex'),
		pairs: [...pairing].sort((a, b) => a[0] - b[0])
	});
	const hash = sha256(canonical);
	db()
		.prepare(
			'INSERT INTO draw_commitments (season_id, version, hash, payload_sealed, reason, arrangements) VALUES (?, ?, ?, ?, ?, ?)'
		)
		.run(seasonId, version, hash, seal(canonical), reason, arrangements);
	return hash;
}

export function sealDraw(season: Season, actorId: number): { ok: true } | { ok: false; reason: string; stuckNames: string[] } {
	if (season.status !== 'setup') return { ok: false, reason: 'This draw is already sealed.', stuckNames: [] };
	const people = participantIds(season.id);
	const problem = buildProblem(season, people);
	const result = solveDraw(problem);
	if (!result.ok) {
		const names = result.stuck.map((id) => getPerson(id)?.display_name ?? 'Unknown');
		return { ok: false, reason: result.reason, stuckNames: names };
	}
	tx(() => {
		db().prepare('DELETE FROM assignments WHERE season_id = ?').run(season.id);
		const insert = db().prepare(
			'INSERT INTO assignments (season_id, giver_id, receiver_sealed) VALUES (?, ?, ?)'
		);
		for (const [giver, receiver] of result.pairing) insert.run(season.id, giver, seal(receiver));
		writeCommitment(season.id, result.pairing, 'The draw was sealed.', countArrangements(problem));
		setSeasonStatus(season.id, 'sealed');
		logAudit(actorId, 'draw.sealed', `${people.length} people`);
		postNotice({
			seasonId: season.id,
			kind: 'draw',
			title: 'The names are sealed!',
			body: 'Santa has sealed the draw. Open your name to find out who you are shopping for.',
			link: '/draw'
		});
	});
	return { ok: true };
}

/** Draws are open once sealed, unless the admin picked a later opening time. */
export function drawIsOpen(season: Season): boolean {
	if (season.status === 'setup' || season.status === 'archived') return false;
	return !season.draw_opens_at || season.draw_opens_at <= nowIso();
}

export function hasAssignment(seasonId: number, profileId: number): boolean {
	return !!db()
		.prepare('SELECT 1 FROM assignments WHERE season_id = ? AND giver_id = ?')
		.get(seasonId, profileId);
}

export function hasRevealed(seasonId: number, profileId: number): boolean {
	const row = db()
		.prepare('SELECT revealed_at FROM assignments WHERE season_id = ? AND giver_id = ?')
		.get(seasonId, profileId) as { revealed_at: string | null } | undefined;
	return !!row?.revealed_at;
}

/** Marks this profile's own draw as revealed and returns who they have. */
export function revealMyDraw(season: Season, profileId: number): Person | null {
	if (!drawIsOpen(season)) return null;
	const row = db()
		.prepare('SELECT * FROM assignments WHERE season_id = ? AND giver_id = ?')
		.get(season.id, profileId) as AssignmentRow | undefined;
	if (!row) return null;
	if (!row.revealed_at) {
		db()
			.prepare('UPDATE assignments SET revealed_at = ? WHERE season_id = ? AND giver_id = ?')
			.run(nowIso(), season.id, profileId);
	}
	return getPerson(unseal<number>(row.receiver_sealed));
}

/** Who this profile is shopping for. Null until they have revealed their own draw. */
export function myRecipient(seasonId: number, profileId: number): Person | null {
	const row = db()
		.prepare('SELECT * FROM assignments WHERE season_id = ? AND giver_id = ?')
		.get(seasonId, profileId) as AssignmentRow | undefined;
	if (!row?.revealed_at) return null;
	return getPerson(unseal<number>(row.receiver_sealed));
}

export function drawProgress(seasonId: number): { total: number; revealed: number } {
	return db()
		.prepare(
			'SELECT COUNT(*) AS total, COUNT(revealed_at) AS revealed FROM assignments WHERE season_id = ?'
		)
		.get(seasonId) as { total: number; revealed: number };
}

/**
 * Who still has to open their name, for the admin's screens and reminders. People asked to draw
 * again after a change are left out: naming them would show the admin who held the name that changed.
 */
export function peopleWhoHaveNotDrawn(seasonId: number): number[] {
	return (
		db()
			.prepare('SELECT giver_id AS id FROM assignments WHERE season_id = ? AND revealed_at IS NULL AND changed_at IS NULL')
			.all(seasonId) as { id: number }[]
	).map((row) => row.id);
}

/** How many people are drawing again after a change. A count only, never who. */
export function peopleRedrawingCount(seasonId: number): number {
	return (
		db()
			.prepare('SELECT COUNT(*) AS n FROM assignments WHERE season_id = ? AND revealed_at IS NULL AND changed_at IS NOT NULL')
			.get(seasonId) as { n: number }
	).n;
}

/**
 * Posts a notice to whoever is shopping for this person, without returning who that is.
 * The notice reaches the Santa's own profile, so a parent sees it under the kid who drew the name.
 */
export function notifySantaOf(
	seasonId: number,
	subjectId: number,
	notice: { title: string; body?: string; link?: string; kind?: 'list' | 'info' }
): void {
	const rows = db()
		.prepare('SELECT * FROM assignments WHERE season_id = ? AND revealed_at IS NOT NULL')
		.all(seasonId) as AssignmentRow[];
	for (const row of rows) {
		if (unseal<number>(row.receiver_sealed) === subjectId) {
			postNotice({ seasonId, personId: row.giver_id, kind: notice.kind ?? 'list', ...notice });
			return;
		}
	}
}

/* ---- Changes after sealing ---- */

function applyChanges(
	season: Season,
	pairing: Pairing,
	changed: number[],
	reason: string,
	actorId: number
): void {
	const keep = new Set(pairing.keys());
	const existing = db()
		.prepare('SELECT giver_id FROM assignments WHERE season_id = ?')
		.all(season.id) as { giver_id: number }[];
	for (const { giver_id } of existing) {
		if (!keep.has(giver_id)) {
			db().prepare('DELETE FROM assignments WHERE season_id = ? AND giver_id = ?').run(season.id, giver_id);
		}
	}
	// Someone who had already drawn is flagged as redrawing. Someone who hadn't stays on the admin's
	// "waiting on" list exactly as before, so the change can't be spotted by watching that list.
	const upsert = db().prepare(
		`INSERT INTO assignments (season_id, giver_id, receiver_sealed) VALUES (@season, @giver, @sealed)
		 ON CONFLICT (season_id, giver_id) DO UPDATE SET
		   receiver_sealed = excluded.receiver_sealed,
		   changed_at = CASE WHEN assignments.revealed_at IS NOT NULL THEN @now ELSE assignments.changed_at END,
		   revealed_at = NULL`
	);
	const now = nowIso();
	for (const giver of changed) {
		upsert.run({ season: season.id, giver, sealed: seal(pairing.get(giver)), now });
		// Conversations about their old person end, and anything they bought stops counting as
		// "covered" on that list. The purchase stays on record so the admin's gift count doesn't shift
		// and point at who changed.
		const tag = giverTag(season.id, giver);
		db().prepare(`UPDATE threads SET status = 'closed' WHERE season_id = ? AND buyer_tag = ? AND status != 'closed'`).run(season.id, tag);
		db().prepare('UPDATE gifts SET wish_item_id = NULL WHERE season_id = ? AND giver_tag = ?').run(season.id, tag);
		postNotice({
			seasonId: season.id,
			personId: giver,
			kind: 'draw',
			title: 'Santa needs you to draw again',
			body: 'The family changed after the draw, so your name has changed. Open your new name when you are ready.',
			link: '/draw'
		});
	}
	writeCommitment(season.id, pairing, reason);
	logAudit(actorId, 'draw.changed', `${reason} ${changed.length} assignment(s) changed.`);
	postNotice({
		seasonId: season.id,
		kind: 'draw',
		title: 'Santa updated the draw',
		body: `${reason} Only the people affected have been asked to draw again.`,
		link: '/fairness'
	});
}

export function removeAfterSealing(
	season: Season,
	personId: number,
	actorId: number
): { ok: true; changed: number } | { ok: false; reason: string } {
	if (season.status !== 'sealed') return { ok: false, reason: 'This can only be done while the names are sealed.' };
	const person = getPerson(personId);
	if (!person) return { ok: false, reason: 'That person no longer exists.' };
	const people = participantIds(season.id);
	const repair = repairRemoval(buildProblem(season, people), loadPairing(season.id), personId);
	if (!repair) {
		return {
			ok: false,
			reason: 'The rules leave no way to remove them with a small change. Use "Redraw everyone" below, and choose them there.'
		};
	}
	tx(() => {
		setParticipant(season.id, personId, false);
		db()
			.prepare(`UPDATE threads SET status = 'closed' WHERE season_id = ? AND (subject_id = ? OR buyer_tag = ?)`)
			.run(season.id, personId, giverTag(season.id, personId));
		applyChanges(season, repair.pairing, repair.changed, `${person.display_name} is no longer taking part.`, actorId);
	});
	return { ok: true, changed: repair.changed.length };
}

export function addAfterSealing(
	season: Season,
	personId: number,
	actorId: number
): { ok: true; changed: number } | { ok: false; reason: string } {
	if (season.status !== 'sealed') return { ok: false, reason: 'This can only be done while the names are sealed.' };
	const person = getPerson(personId);
	if (!person) return { ok: false, reason: 'That person no longer exists.' };
	const people = participantIds(season.id);
	const repair = repairAddition(
		buildProblem(season, [...new Set([...people, personId])]),
		loadPairing(season.id),
		personId
	);
	if (!repair) {
		return { ok: false, reason: 'The rules leave no way to add them with a small change. Use "Redraw everyone" below, and choose them there.' };
	}
	tx(() => {
		setParticipant(season.id, personId, true);
		applyChanges(
			season,
			repair.pairing,
			[...repair.changed, personId],
			`${person.display_name} joined after the draw.`,
			actorId
		);
	});
	return { ok: true, changed: repair.changed.length };
}

export function fullRedraw(
	season: Season,
	reason: string,
	actorId: number,
	changes: { remove?: number[]; add?: number[] } = {}
): { ok: true } | { ok: false; reason: string; stuckNames: string[] } {
	if (season.status !== 'sealed') return { ok: false, reason: 'This can only be done while the names are sealed.', stuckNames: [] };
	const removing = new Set(changes.remove ?? []);
	const people = [...new Set([...participantIds(season.id), ...(changes.add ?? [])])].filter((id) => !removing.has(id));
	const problem = buildProblem(season, people);
	const result = solveDraw(problem);
	if (!result.ok) {
		return {
			ok: false,
			reason: result.reason,
			stuckNames: result.stuck.map((id) => getPerson(id)?.display_name ?? 'Unknown')
		};
	}
	tx(() => {
		for (const id of changes.add ?? []) setParticipant(season.id, id, true);
		for (const id of removing) setParticipant(season.id, id, false);
		db().prepare('DELETE FROM assignments WHERE season_id = ?').run(season.id);
		const insert = db().prepare('INSERT INTO assignments (season_id, giver_id, receiver_sealed) VALUES (?, ?, ?)');
		for (const [giver, receiver] of result.pairing) insert.run(season.id, giver, seal(receiver));
		db().prepare(`UPDATE threads SET status = 'closed' WHERE season_id = ? AND status != 'closed'`).run(season.id);
		db().prepare('DELETE FROM gifts WHERE season_id = ?').run(season.id);
		writeCommitment(season.id, result.pairing, `Full redraw: ${reason}`, countArrangements(problem));
		logAudit(actorId, 'draw.redrawn', reason);
		postNotice({
			seasonId: season.id,
			kind: 'draw',
			title: 'Santa redrew all the names',
			body: `${reason} Everyone needs to open a new name.`,
			link: '/draw'
		});
	});
	return { ok: true };
}

/* ---- Transparency ---- */

export interface CommitmentView {
	version: number;
	hash: string;
	reason: string;
	arrangements: number | null;
	created_at: string;
}

export function commitments(seasonId: number): CommitmentView[] {
	return db()
		.prepare(
			'SELECT version, hash, reason, arrangements, created_at FROM draw_commitments WHERE season_id = ? ORDER BY version'
		)
		.all(seasonId) as CommitmentView[];
}

export function emergencyReveal(season: Season, actorId: number, reason: string): { giver: string; receiver: string }[] {
	const actor = getPerson(actorId);
	return tx(() => {
		db().prepare('UPDATE seasons SET emergency_reveals = emergency_reveals + 1 WHERE id = ?').run(season.id);
		logAudit(actorId, 'draw.emergency_reveal', reason);
		postNotice({
			seasonId: season.id,
			kind: 'alert',
			title: `${actor?.display_name ?? 'The admin'} used the emergency reveal`,
			body: `Santa's list was opened to the admin. Reason given: ${reason}`,
			link: '/fairness'
		});
		return namedPairs(season.id);
	});
}

function namedPairs(seasonId: number): { giver: string; receiver: string }[] {
	return [...loadPairing(seasonId)].map(([giver, receiver]) => ({
		giver: getPerson(giver)?.display_name ?? 'Unknown',
		receiver: getPerson(receiver)?.display_name ?? 'Unknown'
	}));
}

export function publishResults(season: Season, actorId: number): void {
	tx(() => {
		setSeasonStatus(season.id, 'revealed');
		logAudit(actorId, 'draw.published', season.name);
		postNotice({
			seasonId: season.id,
			kind: 'party',
			title: 'The big reveal is here!',
			body: "Santa has opened the sealed list. Come see who had who, and check that the seal wasn't broken.",
			link: '/reveal'
		});
	});
}

export interface PublishedResults {
	pairs: { giverId: number; giver: string; receiverId: number; receiver: string }[];
	proofs: { version: number; hash: string; reason: string; canonical: string; names: Record<number, string> }[];
}

/** The whole pairing. Refuses to answer until the admin has published the season's results. */
export function publishedResults(seasonId: number): PublishedResults | null {
	const season = getSeason(seasonId);
	// Publishing is what sets revealed_at. Archiving alone must never expose a sealed draw.
	if (!season?.revealed_at) return null;
	const directory = new Map(listPeople({ includeInactive: true }).map((p) => [p.id, p.display_name]));
	const name = (id: number) => directory.get(id) ?? 'Unknown';
	const pairs = [...loadPairing(seasonId)]
		.map(([giverId, receiverId]) => ({
			giverId,
			giver: name(giverId),
			receiverId,
			receiver: name(receiverId)
		}))
		.sort((a, b) => a.giver.localeCompare(b.giver));

	const rows = db()
		.prepare('SELECT * FROM draw_commitments WHERE season_id = ? ORDER BY version')
		.all(seasonId) as { version: number; hash: string; reason: string; payload_sealed: string }[];
	const proofs = rows.map((row) => {
		const canonical = unseal<string>(row.payload_sealed);
		const parsed = JSON.parse(canonical) as { pairs: [number, number][] };
		const names: Record<number, string> = {};
		for (const [giver, receiver] of parsed.pairs) {
			names[giver] = name(giver);
			names[receiver] = name(receiver);
		}
		return { version: row.version, hash: row.hash, reason: row.reason, canonical, names };
	});
	return { pairs, proofs };
}
