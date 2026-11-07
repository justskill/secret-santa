import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { logAudit } from './audit';
import { cleanExpiredSessions } from './auth';
import { dueCountdowns, markCountdownPassed, type Countdown } from './countdowns';
import { db } from './db';
import { backupDir, publicUrl } from './env';
import { postNotice } from './notices';
import { sendNtfy } from './ntfy';
import { fireDueReminders } from './reminders';
import { deliverDueMessages, pingFamiliesAboutNewMail } from './threads';

const TICK_MS = 20_000;
const BACKUP_EVERY_MS = 24 * 3_600_000;
const BACKUPS_KEPT = 14;

let started = false;
let running = false;
let lastBackup = 0;
let lastCleanup = 0;

async function announceCountdown(countdown: Countdown): Promise<void> {
	markCountdownPassed(countdown.id);
	if (countdown.kind === 'list_deadline') {
		postNotice({
			seasonId: countdown.season_id,
			kind: 'deadline',
			title: `${countdown.title}: time's up!`,
			body: countdown.hard_lock
				? 'The deadline has passed, so wish lists are now locked.'
				: 'The deadline has passed. If your list is not finished, please finish it soon.',
			link: '/my-person'
		});
	} else if (countdown.kind === 'exchange') {
		postNotice({
			seasonId: countdown.season_id,
			kind: 'party',
			title: `${countdown.title} is here!`,
			body: 'Merry Christmas from the whole workshop.',
			link: '/'
		});
	}
	if (countdown.kind !== 'custom') {
		await sendNtfy({
			title: `Santa: ${countdown.title} has arrived`,
			message: countdown.kind === 'exchange' ? 'When gifts are open, you can publish the big reveal.' : 'Tap to check who is still behind.',
			click: `${publicUrl()}/admin`,
			tags: ['santa']
		});
	}
}

/** Copies the database into the volume each day and keeps two weeks of snapshots. */
export async function runBackup(): Promise<string> {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const path = resolve(backupDir(), `santa-${stamp}.db`);
	await db().backup(path);
	const snapshots = readdirSync(backupDir())
		.filter((name) => name.startsWith('santa-') && name.endsWith('.db'))
		.map((name) => ({ name, time: statSync(resolve(backupDir(), name)).mtimeMs }))
		.sort((a, b) => b.time - a.time);
	for (const old of snapshots.slice(BACKUPS_KEPT)) unlinkSync(resolve(backupDir(), old.name));
	logAudit(null, 'backup.created', stamp);
	return path;
}

export async function tick(): Promise<void> {
	if (running) return;
	running = true;
	try {
		deliverDueMessages();
		await pingFamiliesAboutNewMail();
		await fireDueReminders();
		for (const countdown of dueCountdowns()) await announceCountdown(countdown);

		const now = Date.now();
		if (now - lastCleanup > 3_600_000) {
			cleanExpiredSessions();
			lastCleanup = now;
		}
		if (now - lastBackup > BACKUP_EVERY_MS) {
			lastBackup = now;
			await runBackup();
		}
	} catch (err) {
		console.error('Scheduler tick failed:', err);
	} finally {
		running = false;
	}
}

export function startScheduler(): void {
	if (started) return;
	started = true;
	// The first backup waits a full day, so restarting the container does not fill the volume.
	lastBackup = Date.now();
	const timer = setInterval(() => void tick(), TICK_MS);
	timer.unref();
	void tick();
}
