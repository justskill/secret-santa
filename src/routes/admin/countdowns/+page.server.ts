import { fail } from '@sveltejs/kit';
import {
	createCountdown,
	deleteCountdown,
	getCountdown,
	listCountdowns,
	updateCountdown,
	type Countdown
} from '$lib/server/countdowns';
import { planReminders, removeScheduledFor } from '$lib/server/reminders';
import { currentSeason } from '$lib/server/season';
import { getSetting } from '$lib/server/settings';
import { utcToZonedInput, zonedInputToUtc } from '$lib/time';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const season = currentSeason();
	const timeZone = getSetting('timezone');
	return {
		hasSeason: !!season,
		countdowns: season
			? listCountdowns(season.id).map((countdown) => ({
					...countdown,
					input: utcToZonedInput(countdown.target_at, timeZone)
				}))
			: []
	};
};

function readForm(form: FormData) {
	const title = String(form.get('title') ?? '').trim();
	const when = String(form.get('when') ?? '');
	const kind = String(form.get('kind') ?? 'custom') as Countdown['kind'];
	const target = zonedInputToUtc(when, getSetting('timezone'));
	if (!title) return { error: 'Please give it a name.' } as const;
	if (!target) return { error: 'Please pick a date and time.' } as const;
	return {
		input: {
			title,
			subtitle: String(form.get('subtitle') ?? ''),
			target_at: target,
			kind: ['list_deadline', 'exchange', 'custom'].includes(kind) ? kind : ('custom' as const),
			hard_lock: form.get('hard_lock') === 'on',
			visible: form.get('visible') === 'on'
		}
	} as const;
}

export const actions: Actions = {
	create: async ({ request }) => {
		const season = currentSeason();
		if (!season) return fail(409, { message: 'Start a season first.' });
		const parsed = readForm(await request.formData());
		if ('error' in parsed) return fail(400, { message: parsed.error });
		createCountdown(season.id, parsed.input!);
		return { message: 'Countdown added! Plan reminders for it on the Reminders page.', ok: true };
	},
	update: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const before = getCountdown(id);
		if (!before) return fail(404, { message: 'That countdown is gone.' });
		const parsed = readForm(form);
		if ('error' in parsed) return fail(400, { message: parsed.error });
		updateCountdown(id, parsed.input!);
		// Reminders name the date, so they have to move along with it.
		if (before.target_at !== parsed.input!.target_at && removeScheduledFor(id) > 0) {
			planReminders(before.season_id, id);
			return { message: 'Saved, and its reminders moved to match the new date.', ok: true };
		}
		return { message: 'Saved.', ok: true };
	},
	delete: async ({ request }) => {
		const form = await request.formData();
		deleteCountdown(Number(form.get('id')));
		return { message: 'Removed.', ok: true };
	}
};
