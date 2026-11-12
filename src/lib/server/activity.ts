import { db } from './db';

/** The ISO week a moment falls in, in UTC, such as "2026-W47". Weeks start on Monday. */
export function isoWeek(at: Date = new Date()): string {
	const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
	// The Thursday of this week decides which year the week belongs to.
	day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
	const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
	const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
	return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const lastNoted = new Map<number, string>();

/**
 * Notes that a signed-in person used the app this week, for a count of active people per week.
 * Signing in isn't enough to count this, because a sign-in lasts 90 days. Only the week is kept,
 * with no time of day, and the database is written at most once per person per week.
 */
export function noteActive(personId: number, at: Date = new Date()): void {
	const week = isoWeek(at);
	if (lastNoted.get(personId) === week) return;
	try {
		db().prepare('INSERT OR IGNORE INTO activity_weeks (person_id, week) VALUES (?, ?)').run(personId, week);
		lastNoted.set(personId, week);
	} catch (err) {
		// This runs on every page, and a count is never worth breaking one.
		console.error('Could not note activity:', err instanceof Error ? err.message : err);
	}
}

export function forgetActivityMemoForTests(): void {
	lastNoted.clear();
}
