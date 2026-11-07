import { error } from '@sveltejs/kit';
import { publicUrl } from '$lib/server/env';
import {
	AUDIENCE_LABELS,
	getReminder,
	markRecipientSent,
	recipientsOf,
	saveDraft,
	setReminderStatus
} from '$lib/server/reminders';
import { draftReminderText } from '$lib/server/santa/writing';
import { getSetting } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

function requireReminder(id: string) {
	const reminder = getReminder(Number(id));
	if (!reminder) throw error(404, 'That reminder is gone.');
	return reminder;
}

export const load: PageServerLoad = ({ params }) => {
	const reminder = requireReminder(params.id);
	return {
		reminder,
		audienceLabel: AUDIENCE_LABELS[reminder.audience],
		recipients: recipientsOf(reminder.id)
	};
};

export const actions: Actions = {
	save: async ({ request, params }) => {
		const reminder = requireReminder(params.id);
		const form = await request.formData();
		saveDraft(reminder.id, String(form.get('draft') ?? ''));
		return { message: 'Saved.' };
	},

	rewrite: async ({ params }) => {
		const reminder = requireReminder(params.id);
		const draft = await draftReminderText({
			title: reminder.title,
			audience: reminder.audience,
			link: publicUrl(),
			familyName: getSetting('family_name')
		});
		saveDraft(reminder.id, draft);
		return { message: 'Santa took another swing at it.' };
	},

	sent: async ({ request, params }) => {
		const reminder = requireReminder(params.id);
		const form = await request.formData();
		markRecipientSent(reminder.id, Number(form.get('person')), form.get('sent') === '1');
		return {};
	},

	done: async ({ params }) => {
		const reminder = requireReminder(params.id);
		setReminderStatus(reminder.id, 'done');
		return { message: 'Filed away. Nice work, head elf.' };
	}
};
