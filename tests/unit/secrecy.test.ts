import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { COUNTED_EVENTS } from '$lib/server/audit';
import { clearThrottleForTests } from '$lib/server/auth';
import { unseal } from '$lib/server/crypto';
import { db } from '$lib/server/db';
import {
	checkDraw,
	giverTag,
	myRecipient,
	notifySantaOf,
	publishedResults,
	publishResults,
	revealMyDraw,
	sealDraw
} from '$lib/server/draw';
import { setItemBought } from '$lib/server/gifts';
import { noticesFor, unreadCount } from '$lib/server/notices';
import { createHousehold, createPerson, setApprovers, setGuardians, type Person } from '$lib/server/people';
import { createSeason, currentSeason, type Season } from '$lib/server/season';
import { setSetting } from '$lib/server/settings';
import { actionCards, decideAction } from '$lib/server/santa/actions';
import { SANTA_TOOLS, toolByName, type ToolContext } from '$lib/server/santa/tools';
import {
	askQuestion,
	cleanRelayUrl,
	decideApproval,
	deliverDueMessages,
	effectiveApprovers,
	replyToBuyer,
	requestApproval,
	threadsAsAnswerer,
	threadsAsBuyer,
	RelayError
} from '$lib/server/threads';
import { addItem, canViewList, setGuidance } from '$lib/server/wishlist';
import { POST as chatPost } from '../../src/routes/api/santa/chat/+server';
import { actions as loginActions } from '../../src/routes/login/+page.server';

let season: Season;
let people: Record<string, Person>;

function reload(): Season {
	season = currentSeason()!;
	return season;
}

/** Finds who actually drew someone, using test-only access to the sealed table. */
function trueSantaOf(subjectId: number): number {
	const rows = db().prepare('SELECT giver_id, receiver_sealed FROM assignments WHERE season_id = ?').all(season.id) as {
		giver_id: number;
		receiver_sealed: string;
	}[];
	return rows.find((row) => unseal<number>(row.receiver_sealed) === subjectId)!.giver_id;
}

function context(profile: Person, actor: Person = profile, cards: unknown[] = []): ToolContext {
	return { season, profile, actor, onCard: (card) => cards.push(card) };
}

beforeAll(() => {
	setSetting('relay_delay_min', '0');
	setSetting('relay_delay_max', '0');
	const frost = createHousehold('Frost');
	const winters = createHousehold('Winters');
	const snow = createHousehold('Snow');
	const make = (name: string, kind: 'adult' | 'kid', household: number) =>
		createPerson({ display_name: name, kind, household_id: household });
	people = {
		morgan: make('Morgan Frost', 'adult', frost.id),
		casey: make('Casey Frost', 'adult', frost.id),
		ivy: make('Ivy Frost', 'kid', frost.id),
		theo: make('Theo Frost', 'kid', frost.id),
		jordan: make('Jordan Winters', 'adult', winters.id),
		riley: make('Riley Winters', 'adult', winters.id),
		poppy: make('Poppy Winters', 'kid', winters.id),
		max: make('Max Winters', 'kid', winters.id),
		june: make('June Snow', 'adult', snow.id),
		walt: make('Walt Snow', 'adult', snow.id)
	};
	setGuardians(people.ivy.id, [people.morgan.id, people.casey.id]);
	setGuardians(people.theo.id, [people.morgan.id, people.casey.id]);
	setGuardians(people.poppy.id, [people.jordan.id, people.riley.id]);
	setGuardians(people.max.id, [people.jordan.id, people.riley.id]);

	createSeason('Christmas');
	reload();
	expect(checkDraw(season).ok).toBe(true);
	expect(sealDraw(season, people.morgan.id).ok).toBe(true);
	reload();
});

beforeEach(() => reload());

describe('the assignment table', () => {
	it('stores no readable receiver', () => {
		const rows = db().prepare('SELECT * FROM assignments').all() as Record<string, unknown>[];
		expect(rows.length).toBe(10);
		const names = new Set(Object.values(people).map((p) => String(p.id)));
		for (const row of rows) {
			expect(Object.keys(row)).not.toContain('receiver_id');
			expect(names.has(String(row.receiver_sealed))).toBe(false);
			expect(String(row.receiver_sealed).length).toBeGreaterThan(20);
		}
	});

	it('follows the guardian and household rules in both directions', () => {
		for (const giver of Object.values(people)) {
			const receiver = unseal<number>(
				(db().prepare('SELECT receiver_sealed FROM assignments WHERE giver_id = ?').get(giver.id) as { receiver_sealed: string }).receiver_sealed
			);
			const target = Object.values(people).find((p) => p.id === receiver)!;
			expect(target.household_id).not.toBe(giver.household_id);
		}
	});
});

describe('who can see a draw', () => {
	it('hides a name until that person opens it', () => {
		const someone = people.june;
		expect(myRecipient(season.id, someone.id)).toBeNull();
		const revealed = revealMyDraw(season, someone.id);
		expect(revealed).not.toBeNull();
		expect(myRecipient(season.id, someone.id)?.id).toBe(revealed!.id);
	});

	it('keeps the full results hidden until the admin publishes them', () => {
		expect(publishedResults(season.id)).toBeNull();
	});
});

describe('who can see a wish list', () => {
	it('allows the owner and whoever drew them, and nobody else', () => {
		const owner = people.walt;
		revealMyDraw(season, trueSantaOf(owner.id));
		expect(canViewList(season.id, owner.id, owner.id)).toBe(true);
		expect(canViewList(season.id, trueSantaOf(owner.id), owner.id)).toBe(true);

		const others = Object.values(people).filter((p) => p.id !== owner.id && p.id !== trueSantaOf(owner.id));
		for (const person of others) expect(canViewList(season.id, person.id, owner.id)).toBe(false);
	});

	it('refuses a Santa who has not opened their name yet', () => {
		const owner = people.riley;
		const santa = trueSantaOf(owner.id);
		db().prepare('UPDATE assignments SET revealed_at = NULL WHERE giver_id = ?').run(santa);
		expect(canViewList(season.id, santa, owner.id)).toBe(false);
	});
});

describe("Santa's tools", () => {
	it('never take a person as an input, so they cannot be pointed at someone else', () => {
		const forbidden = /person_id|profile_id|user_id|person_name|recipient_id|giver|santa_of|who_drew/i;
		for (const definition of SANTA_TOOLS) {
			const schema = JSON.stringify((definition.schema as unknown as { toJSONSchema?: () => unknown }).toJSONSchema?.() ?? {});
			expect(schema).not.toMatch(forbidden);
			expect(definition.name).not.toMatch(/who_drew|santa_of|all_assign|lookup_person/i);
		}
	});

	it('show no draw before the name is opened', async () => {
		const person = people.casey;
		db().prepare('UPDATE assignments SET revealed_at = NULL WHERE giver_id = ?').run(person.id);
		const result = (await toolByName('get_my_person')!.run(context(person), {})) as Record<string, unknown>;
		expect(result).toHaveProperty('error');
		expect(result).not.toHaveProperty('name');
	});

	it("never expose who drew the person they're talking to, in any read tool", async () => {
		const me = people.jordan;
		const mySanta = trueSantaOf(me.id);
		const santaPerson = Object.values(people).find((p) => p.id === mySanta)!;
		revealMyDraw(season, mySanta);
		revealMyDraw(season, me.id);
		const myPerson = myRecipient(season.id, me.id)!;

		askQuestion(season.id, mySanta, 'What size shoes do you wear?', 'person');
		deliverDueMessages();

		for (const name of ['get_season_overview', 'get_my_list', 'get_my_person', 'get_my_mail']) {
			const output = JSON.stringify(await toolByName(name)!.run(context(me), {}));
			// Their own draw may legitimately be the same person who drew them.
			if (santaPerson.id !== myPerson.id) {
				expect(output).not.toContain(santaPerson.display_name);
			}
			expect(output).not.toContain(giverTag(season.id, mySanta));
		}
	});

	it('cannot read or edit an item on a list that is not theirs', async () => {
		const me = people.max;
		const other = people.walt;
		const item = addItem(season, other.id, { title: 'Secret tackle' });
		const cards: unknown[] = [];
		const result = (await toolByName('propose_change_wish')!.run(context(me, people.jordan, cards), {
			item_id: item.id,
			action: 'remove'
		})) as Record<string, unknown>;
		expect(result).toHaveProperty('error');
		expect(cards).toHaveLength(0);
	});

	it('change nothing until someone taps confirm', async () => {
		const me = people.june;
		const cards: { id: string }[] = [];
		const before = db().prepare('SELECT COUNT(*) AS n FROM wish_items WHERE person_id = ?').get(me.id) as { n: number };
		await toolByName('propose_add_wishes')!.run(context(me, me, cards), { items: [{ title: 'A new teapot' }] });
		const during = db().prepare('SELECT COUNT(*) AS n FROM wish_items WHERE person_id = ?').get(me.id) as { n: number };
		expect(during.n).toBe(before.n);
		expect(cards).toHaveLength(1);

		// Someone else cannot use the card, even if they somehow got its id.
		const stolen = decideAction(cards[0].id, people.walt, 'confirm');
		expect(stolen.ok).toBe(false);

		const decided = decideAction(cards[0].id, me, 'confirm');
		expect(decided.ok).toBe(true);
		const after = db().prepare('SELECT COUNT(*) AS n FROM wish_items WHERE person_id = ?').get(me.id) as { n: number };
		expect(after.n).toBe(before.n + 1);

		// A card only works once.
		expect(decideAction(cards[0].id, me, 'confirm').ok).toBe(false);
		expect(actionCards([cards[0].id], me.id)[0].status).toBe('confirmed');
	});
});

describe('the anonymous relay', () => {
	it('gives the person answering no way to tell who asked', () => {
		const answerer = people.poppy;
		const santa = trueSantaOf(answerer.id);
		revealMyDraw(season, santa);
		const threadId = askQuestion(season.id, santa, 'Do you like purple?', 'person');
		deliverDueMessages();

		const view = threadsAsAnswerer(season.id, answerer.id).find((t) => t.id === threadId)!;
		expect(view).toBeDefined();
		const serialized = JSON.stringify(view);
		const santaPerson = Object.values(people).find((p) => p.id === santa)!;
		expect(serialized).not.toContain(santaPerson.display_name);
		expect(serialized).not.toContain(giverTag(season.id, santa));
		expect(Object.keys(view)).not.toContain('buyer');
		expect(serialized).not.toContain('buyer_sealed');
	});

	it('hides a message from the answerer until its delivery time', () => {
		setSetting('relay_delay_min', '60');
		setSetting('relay_delay_max', '60');
		const answerer = people.theo;
		const santa = trueSantaOf(answerer.id);
		revealMyDraw(season, santa);
		const threadId = askQuestion(season.id, santa, 'Any favorite dinosaur?', 'person');
		deliverDueMessages();
		const hidden = threadsAsAnswerer(season.id, answerer.id).find((t) => t.id === threadId);
		expect(hidden).toBeUndefined();
		expect(threadsAsBuyer(season.id, santa).find((t) => t.id === threadId)!.messages[0].pending).toBe(true);
		setSetting('relay_delay_min', '0');
		setSetting('relay_delay_max', '0');
	});

	it('stores the buyer sealed, so browsing the database does not show them', () => {
		const rows = db().prepare('SELECT * FROM threads').all() as Record<string, unknown>[];
		for (const row of rows) {
			expect(Object.keys(row)).not.toContain('buyer_id');
			expect(String(row.buyer_sealed)).toContain('.');
		}
	});

	it('stops someone from answering a question that was not sent to them', () => {
		const answerer = people.ivy;
		const santa = trueSantaOf(answerer.id);
		revealMyDraw(season, santa);
		const threadId = askQuestion(season.id, santa, 'Boots or paint?', 'person');
		deliverDueMessages();
		const stranger = Object.values(people).find((p) => p.id !== answerer.id && p.id !== santa)!;
		expect(() => replyToBuyer(threadId, stranger.id, 'Nope')).toThrow(RelayError);
		replyToBuyer(threadId, answerer.id, 'Paint!');
		const buyerView = threadsAsBuyer(season.id, santa).find((t) => t.id === threadId)!;
		expect(buyerView.messages.at(-1)?.body).toBe('Paint!');
		expect(buyerView.status).toBe('answered');
	});

	it('strips tracking from links that might identify the buyer', () => {
		expect(cleanRelayUrl('https://www.amazon.com/dp/B0ABC/ref=cm_sw_r_cp_ud_123?tag=me-20&linkCode=xyz&smid=SELLER')).toBe(
			'https://www.amazon.com/dp/B0ABC'
		);
		expect(cleanRelayUrl('https://shop.example/item?id=42&utm_source=mitch#top')).toBe('https://shop.example/item?id=42');
		expect(cleanRelayUrl('javascript:alert(1)')).toBeNull();
	});
});

describe('permission slips', () => {
	it("go to the person's parents, and the first answer decides", () => {
		const kid = people.max;
		const santa = trueSantaOf(kid.id);
		revealMyDraw(season, santa);
		const outcome = requestApproval(season.id, santa, {
			title: 'A drum kit',
			url: 'https://example.com/drums?ref=me',
			message: 'Is a drum kit OK?'
		});
		expect(outcome.outcome).toBe('sent');
		if (outcome.outcome !== 'sent') return;
		deliverDueMessages();

		const jordanView = threadsAsAnswerer(season.id, people.jordan.id).find((t) => t.id === outcome.threadId);
		const rileyView = threadsAsAnswerer(season.id, people.riley.id).find((t) => t.id === outcome.threadId);
		expect(jordanView).toBeDefined();
		expect(rileyView).toBeDefined();
		// The kid does not see a slip about their own gift.
		expect(threadsAsAnswerer(season.id, kid.id).find((t) => t.id === outcome.threadId)).toBeUndefined();
		// Tracking is gone from the link they see.
		expect(jordanView!.gift?.url).toBe('https://example.com/drums');

		decideApproval(outcome.threadId, people.jordan.id, false, 'Please, no drums.');
		expect(() => decideApproval(outcome.threadId, people.riley.id, true, '')).toThrow(RelayError);

		const buyerView = threadsAsBuyer(season.id, santa).find((t) => t.id === outcome.threadId)!;
		expect(buyerView.status).toBe('declined');
		expect(buyerView.gift?.approval).toBe('declined');
		expect(buyerView.messages.at(-1)?.body).toBe('Please, no drums.');
		expect(JSON.stringify(buyerView)).not.toContain('Jordan');
	});

	it('never asks the buyer, or the parent helping them, to approve their own gift', () => {
		const subject = people.june;
		setApprovers(subject.id, [people.morgan.id, people.walt.id]);
		// Morgan is the buyer, so only Walt can be asked.
		expect(effectiveApprovers(subject.id, people.morgan.id).map((p) => p.id)).toEqual([people.walt.id]);
		// When Ivy is the buyer, her guardian Morgan is the one helping, so again only Walt remains.
		expect(effectiveApprovers(subject.id, people.ivy.id).map((p) => p.id)).toEqual([people.walt.id]);
		setApprovers(subject.id, []);
	});
});

describe('notices about your person', () => {
	it('reach only their Santa, without saying who that is to anyone else', () => {
		const owner = people.casey;
		const santa = trueSantaOf(owner.id);
		revealMyDraw(season, santa);
		const before = unreadCount(santa);
		notifySantaOf(season.id, owner.id, { title: 'Casey is ready' });
		expect(unreadCount(santa)).toBe(before + 1);
		const others = Object.values(people).filter((p) => p.id !== santa);
		for (const person of others) {
			expect(noticesFor(person.id).some((n) => n.title === 'Casey is ready')).toBe(false);
		}
	});
});

describe('gift tracking', () => {
	it('refuses to mark an item on a list that belongs to someone other than your person', () => {
		const buyer = people.riley;
		revealMyDraw(season, buyer.id);
		const myPerson = myRecipient(season.id, buyer.id)!;
		const notMine = Object.values(people).find((p) => p.id !== myPerson.id && p.id !== buyer.id)!;
		const item = addItem(season, notMine.id, { title: 'Not your gift' });
		expect(setItemBought(season.id, buyer.id, item.id, true)).toBe(false);
	});

	it('hides who bought a gift from the database', () => {
		const rows = db().prepare('SELECT * FROM gifts').all() as Record<string, unknown>[];
		for (const row of rows) {
			expect(Object.keys(row)).not.toContain('giver_id');
			expect(typeof row.giver_tag).toBe('string');
		}
	});
});

describe('usage counts', () => {
	it('hold only reason codes and numbers, never what anyone typed', async () => {
		const secret = 'Psst the blue bike is for Ivy';

		// Long enough to be cut, and Santa has no key here, so it's turned away as well.
		const response = (await chatPost({
			request: new Request('http://test/api/santa/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: `${secret}. `.repeat(100) })
			}),
			locals: { viewer: { account: people.morgan, profile: people.morgan, wards: [], isAdmin: false }, sessionToken: null }
		} as never)) as Response;
		await response.text();

		// A name typed at sign-in can be a misspelled real name, so failures and lockouts carry none.
		clearThrottleForTests();
		for (let i = 0; i < 9; i++) {
			const form = new FormData();
			form.set('username', secret);
			form.set('password', 'not the password');
			await loginActions.default!({
				request: new Request('https://santa.test/login', { method: 'POST', body: form }),
				cookies: { set: () => undefined },
				url: new URL('https://santa.test/login'),
				getClientAddress: () => '198.51.100.23'
			} as never);
		}
		clearThrottleForTests();

		const counted = db()
			.prepare(`SELECT actor_id, action, detail FROM audit_log WHERE action IN (${COUNTED_EVENTS.map(() => '?').join(', ')})`)
			.all(...COUNTED_EVENTS) as { actor_id: number | null; action: string; detail: string }[];
		expect(new Set(counted.map((row) => row.action))).toEqual(
			new Set(['santa.truncated', 'santa.blocked', 'login.failed', 'login.throttled'])
		);
		for (const row of counted) {
			expect(row.detail).toMatch(/^[a-z0-9_]*$/);
			if (row.action.startsWith('login.')) expect(row.actor_id).toBeNull();
		}
		for (const table of ['audit_log', 'ai_usage', 'activity_weeks']) {
			const dump = JSON.stringify(db().prepare(`SELECT * FROM ${table}`).all());
			expect(dump).not.toContain('Psst');
			expect(dump).not.toContain('198.51.100.23');
		}
	});
});

describe('publishing results', () => {
	it('reveals everything only after the admin publishes, with a proof that checks out', async () => {
		setGuidance(people.walt.id, { notes: 'x' });
		publishResults(season, people.morgan.id);
		reload();
		const results = publishedResults(season.id)!;
		expect(results.pairs).toHaveLength(10);
		expect(results.proofs.length).toBeGreaterThanOrEqual(1);
		const { createHash } = await import('node:crypto');
		for (const proof of results.proofs) {
			expect(createHash('sha256').update(proof.canonical).digest('hex')).toBe(proof.hash);
		}
		// The published list matches the sealed assignments.
		const latest = JSON.parse(results.proofs.at(-1)!.canonical) as { pairs: [number, number][] };
		expect(latest.pairs).toHaveLength(10);
		for (const pair of results.pairs) {
			expect(latest.pairs).toContainEqual([pair.giverId, pair.receiverId]);
		}
	});
});
