import { fail } from '@sveltejs/kit';
import { ntfyConfigured } from '$lib/server/ntfy';
import {
	AUDIENCE_LABELS,
	createReminder,
	deleteReminder,
	fireReminder,
	listReminders,
	planReminders,
	recipientsOf,
	setReminderStatus,
	updateReminder,
	type Audience
} from '$lib/server/reminders';
import { currentSeason } from '$lib/server/season';
import { getSetting } from '$lib/server/settings';
import { utcToZonedInput, zonedInputToUtc } from '$lib/time';
import type { Actions, PageServerLoad } from './$types';

function audienceOf(form: FormData): Audience {
	const value = String(form.get('audience'));
	return value in AUDIENCE_LABELS ? (value as Audience) : 'everyone';
}

export const load: PageServerLoad = () => {
	const season = currentSeason();
	const timeZone = getSetting('timezone');
	const reminders = season ? listReminders(season.id) : [];
	return {
		hasSeason: !!season,
		audiences: AUDIENCE_LABELS,
		ntfyOn: ntfyConfigured(),
		ready: reminders
			.filter((r) => r.status === 'ready')
			.map((r) => {
				const recipients = recipientsOf(r.id);
				return { ...r, total: recipients.length, sent: recipients.filter((x) => x.sent_at).length };
			}),
		scheduled: reminders.filter((r) => r.status === 'scheduled').map((r) => ({ ...r, input: utcToZonedInput(r.fire_at, timeZone) })),
		finished: reminders.filter((r) => r.status === 'done' || r.status === 'cancelled')
	};
};

export const actions: Actions = {
	plan: async () => {
		const season = currentSeason();
		if (!season) return fail(409, { message: 'Start a season first.' });
		const created = planReminders(season.id);
		return {
			message: created ? `Santa planned ${created} reminders from your countdowns.` : 'Nothing new to plan. Add a countdown first, or the dates may have passed.',
			ok: true
		};
	},

	create: async ({ request }) => {
		const season = currentSeason();
		if (!season) return fail(409, { message: 'Start a season first.' });
		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();
		const fireAt = zonedInputToUtc(String(form.get('when') ?? ''), getSetting('timezone'));
		if (!title || !fireAt) return fail(400, { message: 'Please fill in the title and the time.' });
		createReminder({
			seasonId: season.id,
			title,
			audience: audienceOf(form),
			fireAt,
			customText: String(form.get('text') ?? ''),
			postNotice: form.get('post_notice') === 'on'
		});
		return { message: 'Reminder scheduled.', ok: true };
	},

	update: async ({ request }) => {
		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();
		const fireAt = zonedInputToUtc(String(form.get('when') ?? ''), getSetting('timezone'));
		if (!title || !fireAt) return fail(400, { message: 'Please fill in the title and the time.' });
		updateReminder(Number(form.get('id')), {
			title,
			audience: audienceOf(form),
			fireAt,
			customText: String(form.get('text') ?? ''),
			postNotice: form.get('post_notice') === 'on'
		});
		return { message: 'Saved.', ok: true };
	},

	delete: async ({ request }) => {
		const form = await request.formData();
		deleteReminder(Number(form.get('id')));
		return { message: 'Removed.', ok: true };
	},

	fireNow: async ({ request }) => {
		const form = await request.formData();
		await fireReminder(Number(form.get('id')));
		return { message: 'Done. If anyone needed it, it is on the desk above.', ok: true };
	},

	done: async ({ request }) => {
		const form = await request.formData();
		setReminderStatus(Number(form.get('id')), 'done');
		return { message: 'Filed away.', ok: true };
	}
};
