import { formatDate } from '$lib/time';
import { exchangeDay, listDeadline } from './countdowns';
import { drawIsOpen, hasAssignment, hasRevealed, myRecipient } from './draw';
import { myGifts } from './gifts';
import { firstNameOf, type Person } from './people';
import { isParticipant, type Season } from './season';
import { getSetting } from './settings';
import { getListMeta, listItems } from './wishlist';

export interface HomeTask {
	key: string;
	title: string;
	detail: string;
	done: boolean;
	href: string;
	action: string;
	blocked?: boolean;
}

function timeUntil(iso: string | undefined): number | null {
	return iso ? new Date(iso).getTime() - Date.now() : null;
}

/** The checklist on the home page. Everything shown here is about this profile only. */
export function homeTasks(season: Season, profile: Person): HomeTask[] {
	if (!isParticipant(season.id, profile.id) && !hasAssignment(season.id, profile.id)) return [];
	const timeZone = getSetting('timezone');
	const items = listItems(season.id, profile.id);
	const meta = getListMeta(season.id, profile.id);
	const deadline = listDeadline(season.id);
	const revealed = hasRevealed(season.id, profile.id);
	const recipient = myRecipient(season.id, profile.id);
	const gifts = recipient ? myGifts(season.id, profile.id) : [];
	const anyBought = gifts.some((gift) => gift.bought);
	const waiting = gifts.filter((gift) => gift.off_list && gift.approval === 'waiting').length;

	const tasks: HomeTask[] = [];

	tasks.push({
		key: 'list',
		title: meta.ready_at ? 'Your wish list is ready' : 'Finish your wish list',
		detail: meta.ready_at
			? `${items.length} ${items.length === 1 ? 'wish' : 'wishes'} on the list. You can still change it.`
			: deadline
				? `${items.length} ${items.length === 1 ? 'wish' : 'wishes'} so far. Due ${formatDate(deadline.target_at, timeZone)}.`
				: `${items.length} ${items.length === 1 ? 'wish' : 'wishes'} so far.`,
		done: !!meta.ready_at,
		href: '/my-list',
		action: meta.ready_at ? 'View list' : 'Add wishes'
	});

	const sealed = season.status !== 'setup';
	tasks.push({
		key: 'draw',
		title: revealed ? `You drew ${firstNameOf(recipient?.display_name ?? 'someone')}` : 'Draw your name',
		detail: revealed
			? 'Keep it secret, keep it safe.'
			: !sealed
				? 'Santa has not sealed the names yet.'
				: drawIsOpen(season)
					? 'Your name is sealed and ready to open.'
					: `Opens ${season.draw_opens_at ? formatDate(season.draw_opens_at, timeZone) : 'soon'}.`,
		done: revealed,
		href: '/draw',
		action: revealed ? 'See it again' : 'Open your name',
		blocked: !revealed && !drawIsOpen(season)
	});

	const exchange = exchangeDay(season.id);
	const left = timeUntil(exchange?.target_at);
	tasks.push({
		key: 'gift',
		title: anyBought ? 'Gift bought' : 'Shop for your person',
		detail: !revealed
			? 'You will see their list after you draw.'
			: waiting
				? `${waiting} permission ${waiting === 1 ? 'slip is' : 'slips are'} waiting for an answer.`
				: anyBought
					? 'Nicely done. The elves are impressed.'
					: left !== null && left > 0
						? `${Math.ceil(left / 86_400_000)} days until Secret Santa day.`
						: 'Check their list and track what you buy.',
		done: anyBought,
		href: '/my-person',
		action: 'Open',
		blocked: !revealed
	});

	// A name waiting to be opened comes before everything else.
	const drawReady = season.status === 'sealed' && drawIsOpen(season) && !revealed;
	return drawReady ? [...tasks.filter((task) => task.key === 'draw'), ...tasks.filter((task) => task.key !== 'draw')] : tasks;
}

/** A line from Santa at the top of the home page. Written from facts, so it costs nothing to show. */
export function santaGreeting(season: Season | null, profile: Person, tasks: HomeTask[]): string {
	const name = firstNameOf(profile.display_name);
	if (!season) return `Ho ho ho, ${name}! The workshop is still being set up. Check back soon.`;
	const open = tasks.find((task) => !task.done && !task.blocked);
	if (!tasks.length) return `Ho ho ho, ${name}! You're sitting this one out, but you're still on the nice list.`;
	if (!open) return `Well done, ${name}! Everything on your list is finished. Now we wait for the big day.`;
	switch (open.key) {
		case 'draw':
			return `Ho ho ho, ${name}! There's a name sealed here just for you. Are you ready to open it?`;
		case 'list':
			return `Ho ho ho, ${name}! My elves can't shop for you if they don't know what you'd like. How's that list coming?`;
		default:
			return `Ho ho ho, ${name}! Time to do some shopping. Your person is counting on you, even if they don't know it yet.`;
	}
}
