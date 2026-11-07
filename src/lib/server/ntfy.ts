import { getSetting } from './settings';

export interface NtfyMessage {
	title: string;
	message: string;
	/** Where tapping the notification goes. */
	click?: string;
	/** Buttons on the notification. Each one opens a link, which can also be an sms: link. */
	actions?: { label: string; url: string }[];
	tags?: string[];
	priority?: 1 | 2 | 3 | 4 | 5;
}

export type NtfyResult = { ok: true } | { ok: false; reason: string };

export function ntfyConfigured(): boolean {
	return !!getSetting('ntfy_topic').trim();
}

/** Builds the JSON publish request. Exported so tests can check that it carries no pairing data. */
export function buildNtfyRequest(message: NtfyMessage): { url: string; init: RequestInit } {
	const base = getSetting('ntfy_url').trim().replace(/\/+$/, '') || 'https://ntfy.sh';
	const token = getSetting('ntfy_token').trim();
	return {
		url: base,
		init: {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: `Bearer ${token}` } : {})
			},
			body: JSON.stringify({
				topic: getSetting('ntfy_topic').trim(),
				title: message.title,
				message: message.message,
				tags: message.tags ?? ['santa'],
				priority: message.priority ?? 3,
				...(message.click ? { click: message.click } : {}),
				...(message.actions?.length
					? { actions: message.actions.map(({ label, url: target }) => ({ action: 'view', label, url: target, clear: true })) }
					: {})
			})
		}
	};
}

/**
 * Sends a push to the admin's phone. A failure here never interrupts the app, because the reminder
 * is still waiting on the Reminder Desk.
 */
export async function sendNtfy(message: NtfyMessage): Promise<NtfyResult> {
	if (!ntfyConfigured()) return { ok: false, reason: 'No ntfy topic is set.' };
	const { url, init } = buildNtfyRequest(message);
	try {
		const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
		if (!response.ok) return { ok: false, reason: `ntfy answered with status ${response.status}.` };
		return { ok: true };
	} catch (err) {
		return { ok: false, reason: err instanceof Error ? err.message : 'Could not reach ntfy.' };
	}
}
