import type { Cookies } from '@sveltejs/kit';
import { db, nowIso } from './db';
import { hashPassword, randomToken, sha256, verifyPassword } from './crypto';
import { getPerson, getPersonByUsername, setPasswordHash, type Person } from './people';
import { publicUrl } from './env';
import { logAudit } from './audit';
import { hasAssignment } from './draw';
import { postNotice } from './notices';
import { currentSeason } from './season';

export const SESSION_COOKIE = 'santa_session';
const SESSION_DAYS = 90;
const INVITE_DAYS = 30;
export const MIN_PASSWORD_LENGTH = 8;

function daysFromNow(days: number): string {
	return new Date(Date.now() + days * 86_400_000).toISOString();
}

export function setSessionCookie(cookies: Cookies, token: string, secure: boolean): void {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		maxAge: SESSION_DAYS * 86_400
	});
}

export function createSession(personId: number): string {
	const token = randomToken();
	db()
		.prepare(
			`INSERT INTO sessions (token_hash, person_id, acting_id, expires_at, last_seen_at)
			 VALUES (?, ?, ?, ?, ?)`
		)
		.run(sha256(token), personId, personId, daysFromNow(SESSION_DAYS), nowIso());
	return token;
}

export interface SessionRow {
	token_hash: string;
	person_id: number;
	acting_id: number;
	expires_at: string;
	last_seen_at: string;
}

export function readSession(token: string): { account: Person; actingId: number } | null {
	const hash = sha256(token);
	const row = db().prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hash) as
		| SessionRow
		| undefined;
	if (!row) return null;
	if (row.expires_at < nowIso()) {
		db().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
		return null;
	}
	const account = getPerson(row.person_id);
	if (!account || !account.active) return null;

	// Slide the expiry forward at most once an hour to avoid a write on every request.
	if (Date.now() - new Date(row.last_seen_at).getTime() > 3_600_000) {
		db()
			.prepare('UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE token_hash = ?')
			.run(daysFromNow(SESSION_DAYS), nowIso(), hash);
	}
	return { account, actingId: row.acting_id };
}

export function setActingProfile(token: string, actingId: number): void {
	db().prepare('UPDATE sessions SET acting_id = ? WHERE token_hash = ?').run(actingId, sha256(token));
}

export function destroySession(token: string): void {
	db().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function destroyAllSessionsFor(personId: number, exceptToken?: string): void {
	const except = exceptToken ? sha256(exceptToken) : '';
	db().prepare('DELETE FROM sessions WHERE person_id = ? AND token_hash != ?').run(personId, except);
}

export function cleanExpiredSessions(): void {
	db().prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso());
	db().prepare('DELETE FROM invites WHERE expires_at < ?').run(nowIso());
}

/* ---- Invites ---- */

/** Creates a one-time sign-in link and cancels any earlier link for the same person. */
export function createInviteLink(personId: number, origin?: string): string {
	const token = randomToken(24);
	db().prepare('DELETE FROM invites WHERE person_id = ?').run(personId);
	db()
		.prepare('INSERT INTO invites (token_hash, person_id, expires_at) VALUES (?, ?, ?)')
		.run(sha256(token), personId, daysFromNow(INVITE_DAYS));
	return `${publicUrl(origin)}/invite/${token}`;
}

export function hasActiveInvite(personId: number): boolean {
	return !!db()
		.prepare('SELECT 1 FROM invites WHERE person_id = ? AND used_at IS NULL AND expires_at > ?')
		.get(personId, nowIso());
}

export function personForInvite(token: string): Person | null {
	const row = db()
		.prepare('SELECT person_id FROM invites WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?')
		.get(sha256(token), nowIso()) as { person_id: number } | undefined;
	if (!row) return null;
	const person = getPerson(row.person_id);
	return person?.active && person.kind === 'adult' ? person : null;
}

export async function acceptInvite(token: string, password: string): Promise<Person | null> {
	const person = personForInvite(token);
	if (!person) return null;
	// Using a reset link gets into that person's account, so during a sealed draw the family is told.
	const season = currentSeason();
	if (person.password_hash && season?.status === 'sealed' && hasAssignment(season.id, person.id)) {
		postNotice({
			seasonId: season.id,
			kind: 'alert',
			title: `${person.display_name}'s password was reset`,
			body: `A reset link from the organizer was used. If that wasn't you, ${person.display_name}, tell the family.`,
			link: '/fairness'
		});
	}
	setPasswordHash(person.id, await hashPassword(password));
	db().prepare('UPDATE invites SET used_at = ? WHERE token_hash = ?').run(nowIso(), sha256(token));
	destroyAllSessionsFor(person.id);
	logAudit(person.id, 'invite.accepted', person.display_name);
	return person;
}

/* ---- Passwords and login throttling ---- */

const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 8;
const failures = new Map<string, { count: number; first: number; turnedAway?: boolean }>();

function throttleKey(ip: string, username: string): string {
	return `${ip}|${username.trim().toLowerCase()}`;
}

export function isThrottled(ip: string, username: string): boolean {
	const entry = failures.get(throttleKey(ip, username));
	if (!entry) return false;
	if (Date.now() - entry.first > WINDOW_MS) {
		failures.delete(throttleKey(ip, username));
		return false;
	}
	return entry.count >= MAX_FAILURES;
}

/**
 * True the first time a throttled sign-in is turned away in a lockout, and false after that. A lockout
 * is counted once, however many more tries it blocks.
 */
export function firstTurnAway(ip: string, username: string): boolean {
	const entry = failures.get(throttleKey(ip, username));
	if (!entry || entry.turnedAway) return false;
	entry.turnedAway = true;
	return true;
}

function recordFailure(ip: string, username: string): void {
	const key = throttleKey(ip, username);
	const entry = failures.get(key);
	if (!entry || Date.now() - entry.first > WINDOW_MS) {
		failures.set(key, { count: 1, first: Date.now() });
	} else {
		entry.count++;
	}
	if (failures.size > 5000) failures.clear();
}

export function clearThrottleForTests(): void {
	failures.clear();
}

export async function attemptLogin(ip: string, username: string, password: string): Promise<Person | null> {
	const person = getPersonByUsername(username);
	const ok = await verifyPassword(password, person?.password_hash ?? null);
	if (!ok || !person) {
		recordFailure(ip, username);
		return null;
	}
	failures.delete(throttleKey(ip, username));
	return person;
}

export async function changePassword(
	person: Person,
	currentPassword: string,
	newPassword: string
): Promise<boolean> {
	const ok = await verifyPassword(currentPassword, person.password_hash);
	if (!ok) return false;
	setPasswordHash(person.id, await hashPassword(newPassword));
	return true;
}

/** Only allows a return address inside this site, so a crafted link can't send someone elsewhere. */
export function safeReturnPath(next: string | null, origin: string): string | null {
	// Browsers strip tabs and newlines from addresses, which turns "/<tab>/evil.com" into "//evil.com".
	if (!next || !next.startsWith('/') || /[\u0000-\u001f\\]/.test(next)) return null;
	try {
		const target = new URL(next, origin);
		return target.origin === origin ? target.pathname + target.search : null;
	} catch {
		return null;
	}
}

/* ---- First-run setup ---- */

let setupToken: string | null = null;

/** Only someone who can read the server logs can claim a brand-new install. */
export function getSetupToken(): string {
	if (!setupToken) setupToken = randomToken(18);
	return setupToken;
}

export function checkSetupToken(token: string): boolean {
	return !!setupToken && token === setupToken;
}
