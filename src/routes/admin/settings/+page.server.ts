import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fail } from '@sveltejs/kit';
import { backupDir, anthropicKey, publicUrl } from '$lib/server/env';
import { sendNtfy } from '$lib/server/ntfy';
import { MODEL_CHOICES, spendSummary } from '$lib/server/santa/client';
import { runBackup } from '$lib/server/scheduler';
import { allSettings, getSetting, setSetting } from '$lib/server/settings';
import { isValidTimeZone } from '$lib/time';
import type { Actions, PageServerLoad } from './$types';

function listBackups() {
	return readdirSync(backupDir())
		.filter((name) => name.startsWith('santa-') && name.endsWith('.db'))
		.map((name) => {
			const stats = statSync(resolve(backupDir(), name));
			return { name, size: stats.size, at: stats.mtime.toISOString() };
		})
		.sort((a, b) => b.at.localeCompare(a.at));
}

export const load: PageServerLoad = () => {
	const settings = allSettings();
	return {
		settings: { ...settings, ntfy_token: settings.ntfy_token ? '********' : '' },
		models: MODEL_CHOICES,
		keySet: !!anthropicKey(),
		spend: spendSummary(),
		backups: listBackups(),
		publicAddress: publicUrl(),
		version: __APP_VERSION__
	};
};

function clampNumber(value: FormDataEntryValue | null, min: number, max: number, fallback: number): string {
	const number = Number(value);
	if (!Number.isFinite(number)) return String(fallback);
	return String(Math.min(max, Math.max(min, number)));
}

export const actions: Actions = {
	family: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('family_name') ?? '').trim();
		const timeZone = String(form.get('timezone') ?? '').trim();
		if (!name) return fail(400, { message: 'Please enter a family name.' });
		if (!isValidTimeZone(timeZone)) {
			return fail(400, { message: `"${timeZone}" isn't a time zone Santa knows. Try something like America/Chicago.` });
		}
		setSetting('family_name', name);
		setSetting('timezone', timeZone);
		return { message: 'Saved.', ok: true };
	},

	santa: async ({ request }) => {
		const form = await request.formData();
		const model = String(form.get('santa_model') ?? '');
		if (MODEL_CHOICES.some((choice) => choice.id === model)) setSetting('santa_model', model);
		const effort = String(form.get('santa_effort') ?? 'low');
		setSetting('santa_effort', ['low', 'medium', 'high'].includes(effort) ? effort : 'low');
		setSetting('santa_enabled', form.get('santa_enabled') === 'on' ? '1' : '0');
		setSetting('santa_web_search', form.get('santa_web_search') === 'on' ? '1' : '0');
		setSetting('santa_daily_cap', clampNumber(form.get('santa_daily_cap'), 1, 500, 40));
		setSetting('ai_budget_usd', clampNumber(form.get('ai_budget_usd'), 0, 1000, 40));
		setSetting('ai_budget_warned', '0');
		return { message: 'Santa has been updated.', ok: true };
	},

	relay: async ({ request }) => {
		const form = await request.formData();
		const min = Number(clampNumber(form.get('relay_delay_min'), 0, 1440, 15));
		const max = Number(clampNumber(form.get('relay_delay_max'), 0, 2880, 120));
		setSetting('relay_delay_min', String(min));
		setSetting('relay_delay_max', String(Math.max(min, max)));
		setSetting('reminder_hour', clampNumber(form.get('reminder_hour'), 0, 23, 9));
		return { message: 'Saved.', ok: true };
	},

	ntfy: async ({ request }) => {
		const form = await request.formData();
		setSetting('ntfy_url', String(form.get('ntfy_url') ?? '').trim() || 'https://ntfy.sh');
		setSetting('ntfy_topic', String(form.get('ntfy_topic') ?? '').trim());
		const token = String(form.get('ntfy_token') ?? '').trim();
		// The form shows stars for a saved token, so leaving it alone must not overwrite the real one.
		if (token !== '********') setSetting('ntfy_token', token);
		setSetting('ntfy_mail_alerts', form.get('ntfy_mail_alerts') === 'on' ? '1' : '0');
		return { message: 'Saved.', ok: true };
	},

	ntfyTest: async () => {
		if (!getSetting('ntfy_topic')) return fail(400, { message: 'Save a topic first.' });
		const result = await sendNtfy({
			title: 'Ho ho ho!',
			message: 'This is a test from your Secret Santa server. Tap to open the Reminder Desk.',
			click: `${publicUrl()}/admin/reminders`,
			tags: ['santa']
		});
		return result.ok
			? { message: 'Sent! Check your phone.', ok: true }
			: fail(502, { message: `That didn't work: ${result.reason}` });
	},

	backup: async () => {
		await runBackup();
		return { message: 'Backup saved.', ok: true };
	}
};
