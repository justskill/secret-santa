import { db, tx } from './db';

export interface Person {
	id: number;
	display_name: string;
	kind: 'adult' | 'kid';
	household_id: number | null;
	username: string | null;
	password_hash: string | null;
	is_admin: number;
	phone: string | null;
	photo: string | null;
	color: string;
	active: number;
	created_at: string;
}

/** The fields safe to send to a browser. Never includes the password hash or phone number. */
export interface PublicPerson {
	id: number;
	name: string;
	firstName: string;
	kind: 'adult' | 'kid';
	color: string;
	photo: string | null;
}

export interface Household {
	id: number;
	name: string;
}

export const ORNAMENT_COLORS = ['cranberry', 'pine', 'gold', 'midnight', 'plum', 'teal', 'copper', 'rose'] as const;

export function firstNameOf(name: string): string {
	return name.trim().split(/\s+/)[0] ?? name;
}

export function toPublic(person: Person): PublicPerson {
	return {
		id: person.id,
		name: person.display_name,
		firstName: firstNameOf(person.display_name),
		kind: person.kind,
		color: person.color,
		photo: person.photo ? `/media/${person.photo}` : null
	};
}

export function getPerson(id: number): Person | null {
	return (db().prepare('SELECT * FROM people WHERE id = ?').get(id) as Person | undefined) ?? null;
}

export function getPersonByUsername(username: string): Person | null {
	return (
		(db().prepare('SELECT * FROM people WHERE username = ? AND active = 1').get(username.trim()) as
			| Person
			| undefined) ?? null
	);
}

export function listPeople(options: { includeInactive?: boolean } = {}): Person[] {
	const where = options.includeInactive ? '' : 'WHERE active = 1';
	return db()
		.prepare(`SELECT * FROM people ${where} ORDER BY kind ASC, display_name COLLATE NOCASE ASC`)
		.all() as Person[];
}

export function listHouseholds(): Household[] {
	return db().prepare('SELECT * FROM households ORDER BY name COLLATE NOCASE').all() as Household[];
}

export function createHousehold(name: string): Household {
	const trimmed = name.trim();
	const existing = db().prepare('SELECT * FROM households WHERE name = ?').get(trimmed) as
		| Household
		| undefined;
	if (existing) return existing;
	const info = db().prepare('INSERT INTO households (name) VALUES (?)').run(trimmed);
	return { id: Number(info.lastInsertRowid), name: trimmed };
}

export function renameHousehold(id: number, name: string): void {
	db().prepare('UPDATE households SET name = ? WHERE id = ?').run(name.trim(), id);
}

export function deleteHousehold(id: number): void {
	db().prepare('DELETE FROM households WHERE id = ?').run(id);
}

/** The household names for a person. A kid with no household of their own goes by their parents'. */
export function householdNamesFor(person: Person): string[] {
	const ids =
		person.household_id !== null
			? [person.household_id]
			: person.kind === 'kid'
				? guardiansOf(person.id).flatMap((guardian) => (guardian.household_id !== null ? [guardian.household_id] : []))
				: [];
	const select = db().prepare('SELECT name FROM households WHERE id = ?');
	return [...new Set(ids)].map((id) => (select.get(id) as { name: string }).name);
}

function nextOrnamentColor(): string {
	const count = (db().prepare('SELECT COUNT(*) AS n FROM people').get() as { n: number }).n;
	return ORNAMENT_COLORS[count % ORNAMENT_COLORS.length];
}

function slugUsername(name: string): string {
	const base =
		firstNameOf(name)
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[^a-z0-9]/g, '') || 'elf';
	let candidate = base;
	let n = 2;
	while (db().prepare('SELECT 1 FROM people WHERE username = ?').get(candidate)) {
		candidate = `${base}${n++}`;
	}
	return candidate;
}

export interface PersonInput {
	display_name: string;
	kind: 'adult' | 'kid';
	household_id?: number | null;
	phone?: string | null;
	is_admin?: boolean;
	color?: string;
	username?: string | null;
}

export function createPerson(input: PersonInput): Person {
	const username = input.kind === 'adult' ? (input.username?.trim() || slugUsername(input.display_name)) : null;
	const info = db()
		.prepare(
			`INSERT INTO people (display_name, kind, household_id, username, is_admin, phone, color)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			input.display_name.trim(),
			input.kind,
			input.household_id ?? null,
			username,
			input.is_admin ? 1 : 0,
			input.kind === 'adult' ? (input.phone?.trim() || null) : null,
			input.color ?? nextOrnamentColor()
		);
	return getPerson(Number(info.lastInsertRowid))!;
}

export function updatePerson(
	id: number,
	input: Partial<PersonInput> & { active?: boolean; photo?: string | null }
): void {
	const current = getPerson(id);
	if (!current) return;
	const kind = input.kind ?? current.kind;
	db()
		.prepare(
			`UPDATE people SET display_name = ?, kind = ?, household_id = ?, username = ?, is_admin = ?,
			 phone = ?, color = ?, active = ?, photo = ? WHERE id = ?`
		)
		.run(
			input.display_name?.trim() ?? current.display_name,
			kind,
			input.household_id === undefined ? current.household_id : input.household_id,
			kind === 'kid'
				? null
				: input.username !== undefined
					? input.username?.trim() || null
					: (current.username ?? slugUsername(input.display_name ?? current.display_name)),
			kind === 'kid' ? 0 : input.is_admin === undefined ? current.is_admin : input.is_admin ? 1 : 0,
			kind === 'kid' ? null : input.phone === undefined ? current.phone : input.phone?.trim() || null,
			input.color ?? current.color,
			input.active === undefined ? current.active : input.active ? 1 : 0,
			input.photo === undefined ? current.photo : input.photo,
			id
		);
}

export function setPasswordHash(id: number, hash: string): void {
	db().prepare('UPDATE people SET password_hash = ? WHERE id = ?').run(hash, id);
}

export function wardsOf(guardianId: number): Person[] {
	return db()
		.prepare(
			`SELECT p.* FROM guardianships g JOIN people p ON p.id = g.ward_id
			 WHERE g.guardian_id = ? AND p.active = 1 ORDER BY p.display_name COLLATE NOCASE`
		)
		.all(guardianId) as Person[];
}

export function guardiansOf(wardId: number): Person[] {
	return db()
		.prepare(
			`SELECT p.* FROM guardianships g JOIN people p ON p.id = g.guardian_id
			 WHERE g.ward_id = ? AND p.active = 1 ORDER BY p.display_name COLLATE NOCASE`
		)
		.all(wardId) as Person[];
}

export function isGuardianOf(guardianId: number, wardId: number): boolean {
	return !!db()
		.prepare('SELECT 1 FROM guardianships WHERE guardian_id = ? AND ward_id = ?')
		.get(guardianId, wardId);
}

export function setGuardians(wardId: number, guardianIds: number[]): void {
	tx(() => {
		db().prepare('DELETE FROM guardianships WHERE ward_id = ?').run(wardId);
		const insert = db().prepare('INSERT INTO guardianships (guardian_id, ward_id) VALUES (?, ?)');
		for (const id of new Set(guardianIds)) if (id !== wardId) insert.run(id, wardId);
	});
}

export function explicitApproverIds(personId: number): number[] {
	return (
		db().prepare('SELECT approver_id AS id FROM approvers WHERE person_id = ?').all(personId) as {
			id: number;
		}[]
	).map((row) => row.id);
}

export function setApprovers(personId: number, approverIds: number[]): void {
	tx(() => {
		db().prepare('DELETE FROM approvers WHERE person_id = ?').run(personId);
		const insert = db().prepare('INSERT INTO approvers (person_id, approver_id) VALUES (?, ?)');
		for (const id of new Set(approverIds)) if (id !== personId) insert.run(personId, id);
	});
}

/**
 * Who answers "is this OK to buy?" about a person.
 * An explicit choice wins, then a kid's guardians, then the other adults in the household.
 */
export function approversFor(personId: number): Person[] {
	const explicit = db()
		.prepare(
			`SELECT p.* FROM approvers a JOIN people p ON p.id = a.approver_id
			 WHERE a.person_id = ? AND p.active = 1`
		)
		.all(personId) as Person[];
	if (explicit.length) return explicit;

	const person = getPerson(personId);
	if (!person) return [];
	if (person.kind === 'kid') return guardiansOf(personId);
	if (person.household_id === null) return [];
	return db()
		.prepare(
			`SELECT * FROM people
			 WHERE household_id = ? AND id != ? AND kind = 'adult' AND active = 1`
		)
		.all(person.household_id, personId) as Person[];
}

export function adminExists(): boolean {
	return !!db().prepare('SELECT 1 FROM people WHERE is_admin = 1 AND password_hash IS NOT NULL').get();
}

export function admins(): Person[] {
	return db().prepare('SELECT * FROM people WHERE is_admin = 1 AND active = 1').all() as Person[];
}
