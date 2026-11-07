import { db } from './db';

export const SETTING_DEFAULTS = {
	family_name: 'Our Family',
	timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
	santa_enabled: '1',
	santa_model: 'claude-opus-5-5',
	santa_effort: 'low',
	santa_web_search: '1',
	santa_daily_cap: '40',
	ai_budget_usd: '40',
	ai_budget_warned: '0',
	relay_delay_min: '15',
	relay_delay_max: '120',
	reminder_hour: '9',
	ntfy_url: 'https://ntfy.sh',
	ntfy_topic: '',
	ntfy_token: '',
	ntfy_mail_alerts: '1'
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export function getSetting(key: SettingKey): string {
	const row = db().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
		| { value: string }
		| undefined;
	return row?.value ?? SETTING_DEFAULTS[key];
}

export function getNumberSetting(key: SettingKey): number {
	const value = Number(getSetting(key));
	return Number.isFinite(value) ? value : Number(SETTING_DEFAULTS[key]);
}

export function setSetting(key: SettingKey, value: string): void {
	db()
		.prepare(
			'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
		)
		.run(key, value);
}

export function allSettings(): Record<SettingKey, string> {
	const out = { ...SETTING_DEFAULTS } as Record<SettingKey, string>;
	const rows = db().prepare('SELECT key, value FROM settings').all() as {
		key: SettingKey;
		value: string;
	}[];
	for (const row of rows) if (row.key in SETTING_DEFAULTS) out[row.key] = row.value;
	return out;
}
