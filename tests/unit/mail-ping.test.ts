import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { unseal } from '$lib/server/crypto';
import { db } from '$lib/server/db';
import { revealMyDraw, sealDraw } from '$lib/server/draw';
import { createHousehold, createPerson, setApprovers, setGuardians, type Person } from '$lib/server/people';
import { createSeason, currentSeason, type Season } from '$lib/server/season';
import { setSetting } from '$lib/server/settings';
import {
	askQuestion,
	buildMailPing,
	decideApproval,
	deliverDueMessages,
	followUpFromBuyer,
	pingFamiliesAboutNewMail,
	replyToBuyer,
	requestApproval
} from '$lib/server/threads';

let season: Season;
let people: Record<string, Person>;
let sent: { title: string; message: string; click?: string; actions?: { label: string; url: string }[] }[];
let reachable: boolean;

function trueSantaOf(subjectId: number): number {
	const rows = db().prepare('SELECT giver_id, receiver_sealed FROM assignments WHERE season_id = ?').all(season.id) as {
		giver_id: number;
		receiver_sealed: string;
	}[];
	return rows.find((row) => unseal<number>(row.receiver_sealed) === subjectId)!.giver_id;
}

/** Everything the ping sends, so a test can check that a name or message isn't in any of it. */
function wholePing(): string {
	return decodeURIComponent(JSON.stringify(sent));
}

/** Delivers whatever is due and runs the ping, the same way the scheduler does. */
async function deliverAndPing(): Promise<void> {
	deliverDueMessages();
	await pingFamiliesAboutNewMail();
}

beforeAll(() => {
	setSetting('relay_delay_min', '0');
	setSetting('relay_delay_max', '0');
	setSetting('ntfy_topic', 'santa-test');
	setSetting('ntfy_url', 'https://ntfy.test');

	const frost = createHousehold('The Frosts');
	const winters = createHousehold('The Winters');
	const snow = createHousehold('The Snows');
	const make = (name: string, kind: 'adult' | 'kid', household: number | null) =>
		createPerson({ display_name: name, kind, household_id: household });
	people = {
		morgan: make('Morgan Frost', 'adult', frost.id),
		casey: make('Casey Frost', 'adult', frost.id),
		ivy: make('Ivy Frost', 'kid', frost.id),
		jordan: make('Jordan Winters', 'adult', winters.id),
		riley: make('Riley Winters', 'adult', winters.id),
		poppy: make('Poppy Winters', 'kid', winters.id),
		june: make('June Snow', 'adult', snow.id),
		walt: make('Walt Snow', 'adult', snow.id)
	};
	setGuardians(people.ivy.id, [people.morgan.id, people.casey.id]);
	setGuardians(people.poppy.id, [people.jordan.id, people.riley.id]);

	createSeason('Christmas');
	season = currentSeason()!;
	expect(sealDraw(season, people.morgan.id).ok).toBe(true);
	season = currentSeason()!;
	for (const person of Object.values(people)) revealMyDraw(season, person.id);
});

beforeEach(async () => {
	sent = [];
	reachable = true;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_url: string, init: RequestInit) => {
			if (!reachable) throw new Error('ntfy is down');
			sent.push(JSON.parse(init.body as string));
			return new Response('{}');
		})
	);
	// Starts each test with nothing queued from the one before.
	await pingFamiliesAboutNewMail();
	sent = [];
});

afterEach(() => vi.unstubAllGlobals());

afterAll(() => {
	setSetting('ntfy_topic', '');
});

describe('the mail ping', () => {
	it('names the family and nothing else', async () => {
		const subject = people.june;
		const santa = trueSantaOf(subject.id);
		askQuestion(season.id, santa, 'Would you like a purple scarf?', 'person');
		await deliverAndPing();

		expect(sent).toHaveLength(1);
		expect(sent[0].title).toBe('North Pole Mail: The Snows');
		const ping = wholePing();
		expect(ping).not.toContain('purple');
		expect(ping).not.toContain('scarf');
		for (const person of Object.values(people)) {
			expect(ping).not.toContain(person.display_name);
			expect(ping).not.toContain(person.display_name.split(' ')[0]);
		}
	});

	it('takes only family names, so a message or name has no way into it', () => {
		const ping = buildMailPing(['The Frosts']);
		expect(ping.title).toBe('North Pole Mail: The Frosts');
		expect(buildMailPing.length).toBe(1);
	});

	it('goes out when the message is delivered, not when it is written', async () => {
		setSetting('relay_delay_min', '60');
		setSetting('relay_delay_max', '60');
		const subject = people.walt;
		const threadId = askQuestion(season.id, trueSantaOf(subject.id), 'Any favorite lure?', 'person');
		await deliverAndPing();
		expect(sent).toHaveLength(0);

		db().prepare('UPDATE thread_messages SET deliver_at = ? WHERE thread_id = ?').run('2000-01-01T00:00:00.000Z', threadId);
		await deliverAndPing();
		expect(sent).toHaveLength(1);
		setSetting('relay_delay_min', '0');
		setSetting('relay_delay_max', '0');
	});

	it('names the family when a message is for a kid, or a permission slip goes to the parents', async () => {
		askQuestion(season.id, trueSantaOf(people.poppy.id), 'Which color skates?', 'person');
		await deliverAndPing();
		expect(sent.at(-1)?.title).toBe('North Pole Mail: The Winters');

		sent = [];
		requestApproval(season.id, trueSantaOf(people.ivy.id), { title: 'A drum kit', message: 'Is a drum kit OK?' });
		await deliverAndPing();
		expect(sent.at(-1)?.title).toBe('North Pole Mail: The Frosts');
		expect(wholePing()).not.toContain('drum');
	});

	it('also goes out for a follow-up from the buyer', async () => {
		const subject = people.jordan;
		const santa = trueSantaOf(subject.id);
		const threadId = askQuestion(season.id, santa, 'What size?', 'person');
		await deliverAndPing();
		sent = [];
		followUpFromBuyer(threadId, santa, 'And what color?');
		await deliverAndPing();
		expect(sent.map((ping) => ping.title)).toEqual(['North Pole Mail: The Winters']);
	});

	it('never goes out for an answer, because that would name the family of the person who asked', async () => {
		const subject = people.riley;
		const santa = trueSantaOf(subject.id);
		const threadId = askQuestion(season.id, santa, 'Socks?', 'person');
		await deliverAndPing();
		sent = [];
		replyToBuyer(threadId, subject.id, 'Yes please');
		await deliverAndPing();
		expect(sent).toHaveLength(0);

		const parentOfKid = people.morgan;
		const slip = requestApproval(season.id, trueSantaOf(people.ivy.id), { title: 'A kazoo', message: 'A kazoo?' });
		if (slip.outcome !== 'sent') throw new Error('expected a sent slip');
		await deliverAndPing();
		sent = [];
		decideApproval(slip.threadId, parentOfKid.id, true, 'Fine');
		await deliverAndPing();
		expect(sent).toHaveLength(0);
	});

	it('says the same thing whoever asked, even when the buyer is left off the mailing', async () => {
		const subject = people.june;
		const santa = trueSantaOf(subject.id);
		const other = Object.values(people).find(
			(person) =>
				person.kind === 'adult' &&
				person.id !== santa &&
				person.household_id !== subject.household_id &&
				person.household_id !== Object.values(people).find((p) => p.id === santa)!.household_id
		)!;
		// Only "other" receives this one, because the buyer is never asked about their own person.
		setApprovers(subject.id, [santa, other.id]);
		askQuestion(season.id, santa, 'Hat or gloves?', 'helpers');
		await deliverAndPing();
		setApprovers(subject.id, []);

		const santaFamily = db().prepare('SELECT name FROM households WHERE id = (SELECT household_id FROM people WHERE id = ?)').get(santa) as { name: string };
		const otherFamily = db().prepare('SELECT name FROM households WHERE id = ?').get(other.household_id) as { name: string };
		expect(sent).toHaveLength(1);
		// Naming only the other family would show that the buyer's family was the one left out.
		expect(sent[0].title).toContain(santaFamily.name);
		expect(sent[0].title).toContain(otherFamily.name);
	});

	it('sends one ping when several messages arrive together', async () => {
		askQuestion(season.id, trueSantaOf(people.june.id), 'One?', 'person');
		askQuestion(season.id, trueSantaOf(people.walt.id), 'Two?', 'person');
		await deliverAndPing();
		expect(sent).toHaveLength(1);
		expect(sent[0].title).toBe('North Pole Mail: The Snows');
	});

	it('offers a text with the link already filled in, and no name', async () => {
		askQuestion(season.id, trueSantaOf(people.casey.id), 'Coffee?', 'person');
		await deliverAndPing();
		const action = sent[0].actions![0];
		expect(action.label).toBe('Text someone');
		expect(action.url.startsWith('sms:?&body=')).toBe(true);
		expect(decodeURIComponent(action.url)).toContain('https://santa.test');
	});

	it('keeps trying when ntfy is down, without asking it every few seconds', async () => {
		reachable = false;
		askQuestion(season.id, trueSantaOf(people.morgan.id), 'Skillet?', 'person');
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await deliverAndPing();
		expect(sent).toHaveLength(0);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(String(warn.mock.calls[0][0])).not.toContain('Frost');

		reachable = true;
		await pingFamiliesAboutNewMail();
		expect(sent).toHaveLength(0);

		const realNow = Date.now();
		const clock = vi.spyOn(Date, 'now').mockReturnValue(realNow + 6 * 60_000);
		await pingFamiliesAboutNewMail();
		clock.mockRestore();
		warn.mockRestore();
		expect(sent.map((ping) => ping.title)).toEqual(['North Pole Mail: The Frosts']);

		// Once it has gone through, it isn't sent again.
		await pingFamiliesAboutNewMail();
		expect(sent).toHaveLength(1);
	});

	it('can be turned off, and turning it back on does not announce old mail', async () => {
		setSetting('ntfy_mail_alerts', '0');
		askQuestion(season.id, trueSantaOf(people.june.id), 'Herbs?', 'person');
		await deliverAndPing();
		expect(sent).toHaveLength(0);

		setSetting('ntfy_mail_alerts', '1');
		await pingFamiliesAboutNewMail();
		expect(sent).toHaveLength(0);
	});

	it('does not announce mail from before ntfy was set up', async () => {
		setSetting('ntfy_topic', '');
		askQuestion(season.id, trueSantaOf(people.walt.id), 'Lures?', 'person');
		await deliverAndPing();
		setSetting('ntfy_topic', 'santa-test');
		await pingFamiliesAboutNewMail();
		expect(sent).toHaveLength(0);
	});

	it("uses a kid's parents when the kid has no household, and says so when nobody has one", async () => {
		const lateKid = createPerson({ display_name: 'Arlo Late', kind: 'kid', household_id: null });
		setGuardians(lateKid.id, [people.june.id]);
		const loner = createPerson({ display_name: 'Sam Solo', kind: 'adult', household_id: null });
		const insert = db().prepare(
			`INSERT INTO threads (id, season_id, kind, route, subject_id, buyer_tag, buyer_sealed) VALUES (?, ?, 'question', 'person', ?, 'tag', 'sealed')`
		);
		const message = db().prepare(
			`INSERT INTO thread_messages (id, thread_id, direction, body, deliver_at) VALUES (?, ?, 'to_answerer', 'Hello', '2000-01-01T00:00:00.000Z')`
		);

		insert.run('kid-thread', season.id, lateKid.id);
		message.run('kid-message', 'kid-thread');
		await deliverAndPing();
		expect(sent.at(-1)?.title).toBe('North Pole Mail: The Snows');
		expect(wholePing()).not.toContain('Arlo');

		sent = [];
		insert.run('solo-thread', season.id, loner.id);
		message.run('solo-message', 'solo-thread');
		await deliverAndPing();
		expect(sent.at(-1)?.title).toBe('North Pole Mail: someone with no household');
		expect(sent.at(-1)?.message).toContain('People page');
		expect(wholePing()).not.toContain('Sam');
	});
});
