import { db, nowIso, tx } from './db';
import { listCountdowns } from './countdowns';
import { peopleWhoHaveNotDrawn } from './draw';
import { publicUrl } from './env';
import { peopleWithNoGift } from './gifts';
import { postNotice } from './notices';
import { sendNtfy, ntfyConfigured } from './ntfy';
import { firstNameOf, getPerson, guardiansOf, type Person } from './people';
import { draftReminderText } from './santa/writing';
import { getSeason, participantIds, type Season } from './season';
import { getNumberSetting, getSetting } from './settings';
import { formatDate, zonedInputToUtc, utcToZonedInput } from '$lib/time';
import { peopleWithListNotReady } from './wishlist';

export type Audience = 'everyone' | 'list_not_ready' | 'not_drawn' | 'no_gift_yet';
export type ReminderStatus = 'scheduled' | 'ready' | 'done' | 'cancelled';

export const AUDIENCE_LABELS: Record<Audience, string> = {
	everyone: 'Everyone',
	list_not_ready: "People whose list isn't ready",
	not_drawn: "People who haven't drawn yet",
	no_gift_yet: "People who haven't bought a gift yet"
};

export interface Reminder {
	id: number;
	season_id: number;
	countdown_id: number | null;
	title: string;
	audience: Audience;
	fire_at: string;
	status: ReminderStatus;
	custom_text: string | null;
	draft: string | null;
	post_notice: number;
	fired_at: string | null;
	ntfy_result: string | null;
	created_at: string;
}

export interface ReminderRecipient {
	person_id: number;
	name: string;
	phone: string | null;
	about: string[];
	sent_at: string | null;
}

export function listReminders(seasonId: number): Reminder[] {
	return db()
		.prepare('SELECT * FROM reminders WHERE season_id = ? ORDER BY fire_at ASC')
		.all(seasonId) as Reminder[];
}

export function getReminder(id: number): Reminder | null {
	return (db().prepare('SELECT * FROM reminders WHERE id = ?').get(id) as Reminder | undefined) ?? null;
}

export function createReminder(input: {
	seasonId: number;
	title: string;
	audience: Audience;
	fireAt: string;
	customText?: string | null;
	countdownId?: number | null;
	postNotice?: boolean;
}): number {
	const info = db()
		.prepare(
			`INSERT INTO reminders (season_id, countdown_id, title, audience, fire_at, custom_text, post_notice)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			input.seasonId,
			input.countdownId ?? null,
			input.title.trim(),
			input.audience,
			input.fireAt,
			input.customText?.trim() || null,
			input.postNotice === false ? 0 : 1
		);
	return Number(info.lastInsertRowid);
}

export function updateReminder(
	id: number,
	input: { title: string; audience: Audience; fireAt: string; customText?: string | null; postNotice?: boolean }
): void {
	db()
		.prepare(
			`UPDATE reminders SET title = ?, audience = ?, fire_at = ?, custom_text = ?, post_notice = ?
			 WHERE id = ? AND status = 'scheduled'`
		)
		.run(input.title.trim(), input.audience, input.fireAt, input.customText?.trim() || null, input.postNotice === false ? 0 : 1, id);
}

export function setReminderStatus(id: number, status: ReminderStatus): void {
	db().prepare('UPDATE reminders SET status = ? WHERE id = ?').run(status, id);
}

export function deleteReminder(id: number): void {
	db().prepare('DELETE FROM reminders WHERE id = ?').run(id);
}

export function saveDraft(id: number, draft: string): void {
	db().prepare('UPDATE reminders SET draft = ? WHERE id = ?').run(draft.trim().slice(0, 1500), id);
}

export function recipientsOf(reminderId: number): ReminderRecipient[] {
	const rows = db()
		.prepare(
			`SELECT r.person_id, p.display_name AS name, p.phone, r.about_json, r.sent_at
			 FROM reminder_recipients r JOIN people p ON p.id = r.person_id
			 WHERE r.reminder_id = ? ORDER BY p.display_name COLLATE NOCASE`
		)
		.all(reminderId) as { person_id: number; name: string; phone: string | null; about_json: string; sent_at: string | null }[];
	return rows.map((row) => ({
		person_id: row.person_id,
		name: row.name,
		phone: row.phone,
		sent_at: row.sent_at,
		about: JSON.parse(row.about_json) as string[]
	}));
}

export function markRecipientSent(reminderId: number, personId: number, sent: boolean): void {
	db()
		.prepare('UPDATE reminder_recipients SET sent_at = ? WHERE reminder_id = ? AND person_id = ?')
		.run(sent ? nowIso() : null, reminderId, personId);
}

function audiencePeople(season: Season, audience: Audience): number[] {
	switch (audience) {
		case 'everyone':
			return participantIds(season.id);
		case 'list_not_ready':
			return peopleWithListNotReady(season.id, participantIds(season.id));
		case 'not_drawn':
			return season.status === 'setup' ? [] : peopleWhoHaveNotDrawn(season.id);
		case 'no_gift_yet':
			return season.status === 'setup' ? [] : peopleWithNoGift(season.id);
	}
}

/**
 * Turns an audience into the adults to text. Kids have no phone in the app, so their reminder goes
 * to their guardians and says which kid it is about.
 */
export function textTargets(people: Person[]): { adult: Person; about: string[] }[] {
	const targets = new Map<number, { adult: Person; about: string[] }>();
	const add = (adult: Person, about?: string) => {
		const entry = targets.get(adult.id) ?? { adult, about: [] };
		if (about) entry.about.push(about);
		targets.set(adult.id, entry);
	};
	for (const person of people) {
		if (person.kind === 'adult') add(person);
		else for (const guardian of guardiansOf(person.id)) add(guardian, firstNameOf(person.display_name));
	}
	return [...targets.values()];
}

function linkFor(audience: Audience): string {
	return audience === 'list_not_ready' ? '/my-list' : audience === 'not_drawn' ? '/draw' : audience === 'no_gift_yet' ? '/my-person' : '/';
}

/** Moves a reminder to the Reminder Desk, writes its text, and pings the admin's phone. */
export async function fireReminder(id: number): Promise<void> {
	const reminder = getReminder(id);
	if (!reminder || reminder.status !== 'scheduled') return;
	const season = getSeason(reminder.season_id);
	if (!season) return;

	const people = audiencePeople(season, reminder.audience)
		.map((personId) => getPerson(personId))
		.filter((person): person is Person => !!person && !!person.active);
	const targets = textTargets(people);

	if (!targets.length) {
		db()
			.prepare(`UPDATE reminders SET status = 'done', fired_at = ?, ntfy_result = ? WHERE id = ?`)
			.run(nowIso(), 'Nobody needed this reminder.', id);
		return;
	}

	const draft =
		reminder.custom_text ??
		(await draftReminderText({
			title: reminder.title,
			audience: reminder.audience,
			link: publicUrl(),
			familyName: getSetting('family_name')
		}));

	tx(() => {
		db()
			.prepare(`UPDATE reminders SET status = 'ready', fired_at = ?, draft = ? WHERE id = ?`)
			.run(nowIso(), draft, id);
		const insert = db().prepare(
			'INSERT OR REPLACE INTO reminder_recipients (reminder_id, person_id, about_json) VALUES (?, ?, ?)'
		);
		for (const { adult, about } of targets) insert.run(id, adult.id, JSON.stringify(about));
		if (reminder.post_notice) {
			for (const person of people) {
				postNotice({
					seasonId: season.id,
					personId: person.id,
					kind: 'reminder',
					title: reminder.title,
					body: draft,
					link: linkFor(reminder.audience)
				});
			}
		}
	});

	if (ntfyConfigured()) {
		const result = await sendNtfy({
			title: `Santa: ${reminder.title}`,
			message: `${targets.length} ${targets.length === 1 ? 'person' : 'people'} to text. Tap to open the Reminder Desk.`,
			click: `${publicUrl()}/admin/reminders/${id}`,
			tags: ['santa', 'bell']
		});
		db()
			.prepare('UPDATE reminders SET ntfy_result = ? WHERE id = ?')
			.run(result.ok ? 'Sent to your phone.' : result.reason, id);
	} else {
		db().prepare('UPDATE reminders SET ntfy_result = ? WHERE id = ?').run('ntfy is not set up, so nothing was sent to your phone.', id);
	}
}

export async function fireDueReminders(): Promise<void> {
	const due = db()
		.prepare(
			`SELECT r.id FROM reminders r JOIN seasons s ON s.id = r.season_id
			 WHERE r.status = 'scheduled' AND r.fire_at <= ? AND s.status != 'archived'`
		)
		.all(nowIso()) as { id: number }[];
	for (const { id } of due) await fireReminder(id);
}

/** Removes a countdown's unsent reminders, for when its date moves. Returns how many there were. */
export function removeScheduledFor(countdownId: number): number {
	return db().prepare(`DELETE FROM reminders WHERE countdown_id = ? AND status = 'scheduled'`).run(countdownId).changes;
}

function atReminderHour(targetIso: string, daysBefore: number, timeZone: string): string | null {
	const localDate = utcToZonedInput(new Date(new Date(targetIso).getTime() - daysBefore * 86_400_000).toISOString(), timeZone).slice(0, 10);
	const hour = String(getNumberSetting('reminder_hour')).padStart(2, '0');
	return zonedInputToUtc(`${localDate}T${hour}:00`, timeZone);
}

/**
 * Creates a sensible set of reminders from the season's countdowns, skipping anything already
 * in the past or already planned.
 */
export function planReminders(seasonId: number, onlyCountdownId?: number): number {
	const timeZone = getSetting('timezone');
	const existing = listReminders(seasonId);
	let created = 0;

	const add = (title: string, audience: Audience, targetIso: string, daysBefore: number, countdownId: number) => {
		const fireAt = atReminderHour(targetIso, daysBefore, timeZone);
		if (!fireAt || fireAt <= nowIso()) return;
		if (existing.some((r) => r.countdown_id === countdownId && r.fire_at === fireAt && r.audience === audience)) return;
		createReminder({ seasonId, title, audience, fireAt, countdownId });
		created++;
	};

	for (const countdown of listCountdowns(seasonId)) {
		if (onlyCountdownId !== undefined && countdown.id !== onlyCountdownId) continue;
		const when = formatDate(countdown.target_at, timeZone);
		if (countdown.kind === 'list_deadline') {
			add(`Wish lists are due in a week (${when})`, 'list_not_ready', countdown.target_at, 7, countdown.id);
			add(`Wish lists are due in 3 days (${when})`, 'list_not_ready', countdown.target_at, 3, countdown.id);
			add(`Wish lists are due tomorrow (${when})`, 'list_not_ready', countdown.target_at, 1, countdown.id);
		}
		if (countdown.kind === 'exchange') {
			add(`Two weeks until Secret Santa day (${when})`, 'no_gift_yet', countdown.target_at, 14, countdown.id);
			add(`One week until Secret Santa day (${when})`, 'no_gift_yet', countdown.target_at, 7, countdown.id);
			add(`Secret Santa day is tomorrow (${when})`, 'everyone', countdown.target_at, 1, countdown.id);
		}
	}
	return created;
}
