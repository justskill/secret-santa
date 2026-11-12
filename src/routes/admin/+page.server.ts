import { recentAudit } from '$lib/server/audit';
import { hasActiveInvite } from '$lib/server/auth';
import { listCountdowns } from '$lib/server/countdowns';
import { drawProgress, peopleRedrawingCount, peopleWhoHaveNotDrawn } from '$lib/server/draw';
import { peopleWithNoGift } from '$lib/server/gifts';
import { ntfyConfigured } from '$lib/server/ntfy';
import { getPerson, guardiansOf, listPeople } from '$lib/server/people';
import { listReminders } from '$lib/server/reminders';
import { aiAvailable, santaOutcomes, spendSummary } from '$lib/server/santa/client';
import { anthropicKey } from '$lib/server/env';
import { currentSeason, participantIds } from '$lib/server/season';
import { peopleWithoutApprovers } from '$lib/server/threads';
import { db } from '$lib/server/db';
import { peopleWithListNotReady } from '$lib/server/wishlist';
import type { PageServerLoad } from './$types';

const nameOf = (id: number) => getPerson(id)?.display_name ?? 'Unknown';

export const load: PageServerLoad = () => {
	const season = currentSeason();
	const people = listPeople();
	const adults = people.filter((person) => person.kind === 'adult');
	const spend = spendSummary();
	const outcomes = santaOutcomes();

	if (!season) {
		return { hasSeason: false as const, spend, outcomes, keySet: !!anthropicKey(), aiOn: aiAvailable(), audit: recentAudit(12) };
	}

	const participants = participantIds(season.id);
	const countdowns = listCountdowns(season.id);
	const reminders = listReminders(season.id);
	const sealed = season.status !== 'setup';
	const noLogin = adults.filter((adult) => !adult.password_hash);
	const notReady = peopleWithListNotReady(season.id, participants);
	const progress = sealed ? drawProgress(season.id) : { total: participants.length, revealed: 0 };
	const noGift = sealed ? peopleWithNoGift(season.id) : [];
	const slipsWaiting = (
		db()
			.prepare(`SELECT COUNT(*) AS n FROM threads WHERE season_id = ? AND kind = 'approval' AND status = 'open'`)
			.get(season.id) as { n: number }
	).n;

	const steps = [
		{
			done: people.length >= 3,
			title: 'Add the family',
			detail: `${adults.length} ${adults.length === 1 ? 'adult' : 'adults'} and ${people.length - adults.length} ${people.length - adults.length === 1 ? 'kid' : 'kids'} so far.`,
			href: '/admin/people'
		},
		{
			done: noLogin.length === 0 && adults.length > 0,
			title: 'Send invite links',
			detail: noLogin.length
				? `Still waiting on: ${noLogin.map((p) => `${p.display_name}${hasActiveInvite(p.id) ? ' (invited)' : ''}`).join(', ')}.`
				: 'Every adult can sign in.',
			href: '/admin/people'
		},
		{
			done: countdowns.some((c) => c.kind === 'exchange') && countdowns.some((c) => c.kind === 'list_deadline'),
			title: 'Set the dates',
			detail: countdowns.length ? `${countdowns.length} countdowns set.` : 'Add the list deadline and Secret Santa day.',
			href: '/admin/countdowns'
		},
		{
			done: reminders.length > 0 && ntfyConfigured(),
			title: 'Plan reminders and connect ntfy',
			detail: ntfyConfigured()
				? `${reminders.length} reminders planned.`
				: 'Connect ntfy in Settings so reminders reach your phone.',
			href: '/admin/reminders'
		},
		{
			done: sealed,
			title: 'Seal the draw',
			detail: sealed ? 'Sealed. Pairings stay hidden from you too.' : 'Check the rules, then seal the names.',
			href: '/admin/season'
		},
		{
			done: season.status === 'revealed',
			title: 'Publish the big reveal',
			detail: 'After the gifts are opened.',
			href: '/admin/season'
		}
	];

	return {
		hasSeason: true as const,
		seasonName: season.name,
		status: season.status,
		steps,
		progress,
		participantCount: participants.length,
		listsReady: participants.length - notReady.length,
		notReadyNames: notReady.map(nameOf),
		notDrawnNames: sealed ? peopleWhoHaveNotDrawn(season.id).map(nameOf) : [],
		redrawing: sealed ? peopleRedrawingCount(season.id) : 0,
		noGiftNames: noGift.map(nameOf),
		slipsWaiting,
		noApprover: peopleWithoutApprovers(season.id).map((p) => p.display_name),
		kidsWithoutParents: people.filter((p) => p.kind === 'kid' && !guardiansOf(p.id).length).map((p) => p.display_name),
		readyReminders: reminders.filter((r) => r.status === 'ready').map((r) => ({ id: r.id, title: r.title })),
		nextReminder: reminders.find((r) => r.status === 'scheduled') ?? null,
		spend,
		outcomes,
		keySet: !!anthropicKey(),
		aiOn: aiAvailable(),
		audit: recentAudit(12)
	};
};
