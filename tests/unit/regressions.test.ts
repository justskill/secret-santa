import { beforeAll, describe, expect, it } from 'vitest';
import { acceptInvite, createInviteLink, safeReturnPath } from '$lib/server/auth';
import { dueCountdowns, createCountdown, getCountdown } from '$lib/server/countdowns';
import { unseal } from '$lib/server/crypto';
import { db } from '$lib/server/db';
import {
	addAfterSealing,
	drawProgress,
	emergencyReveal,
	fullRedraw,
	giverTag,
	myRecipient,
	peopleRedrawingCount,
	peopleWhoHaveNotDrawn,
	publishedResults,
	removeAfterSealing,
	revealMyDraw,
	sealDraw
} from '$lib/server/draw';
import { countArrangements } from '$lib/server/draw/solver';
import { coveredItemIds, myGifts, peopleWithNoGift, setItemBought } from '$lib/server/gifts';
import { homeTasks } from '$lib/server/home';
import { deleteAnnouncement, familyAnnouncements, markAllRead, noticesFor, postNotice, unreadCount, unreadPersonalCount } from '$lib/server/notices';
import { createHousehold, createPerson, guardiansOf, setGuardians, type Person } from '$lib/server/people';
import { createReminder, fireDueReminders, getReminder, listReminders, planReminders, removeScheduledFor } from '$lib/server/reminders';
import { isPrivateAddress } from '$lib/server/safefetch';
import { createAction, decideAction } from '$lib/server/santa/actions';
import { recordUsage, totalSpend } from '$lib/server/santa/client';
import { createSeason, currentSeason, getSeason, participantIds, setSeasonStatus, type Season } from '$lib/server/season';
import { setSetting } from '$lib/server/settings';
import {
	askQuestion,
	cleanRelayUrl,
	decideApproval,
	deliverDueMessages,
	followUpFromBuyer,
	mailBadgeCount,
	markThreadRead,
	replyToBuyer,
	requestApproval,
	threadsAsAnswerer,
	threadsAsBuyer,
	waitingOnMe
} from '$lib/server/threads';
import { addItem, getGuidance, setGuidance, setListReady } from '$lib/server/wishlist';
import { actions as seasonActions } from '../../src/routes/admin/season/+page.server';
import { actions as personActions } from '../../src/routes/admin/people/[id]/+page.server';
import { actions as countdownActions } from '../../src/routes/admin/countdowns/+page.server';
import { load as myListLoad } from '../../src/routes/(portal)/my-list/+page.server';

let people: Record<string, Person>;

const season = (): Season => currentSeason()!;
const everyone = () => Object.values(people);

function pairs(seasonId: number): Map<number, number> {
	const rows = db().prepare('SELECT giver_id, receiver_sealed FROM assignments WHERE season_id = ?').all(seasonId) as {
		giver_id: number;
		receiver_sealed: string;
	}[];
	return new Map(rows.map((row) => [row.giver_id, unseal<number>(row.receiver_sealed)]));
}

function viewerFor(person: Person) {
	return { account: person, profile: person, wards: [], isAdmin: !!person.is_admin };
}

function actionEvent(person: Person, fields: Record<string, string | string[]>, params: Record<string, string> = {}) {
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) {
		for (const item of [value].flat()) form.append(key, item);
	}
	return {
		request: new Request('http://test/x', { method: 'POST', body: form }),
		params,
		locals: { viewer: viewerFor(person), sessionToken: null },
		url: new URL('http://test/x')
	} as never;
}

/** A fresh sealed season with everyone's name already opened. */
function freshSealedSeason(name: string): Season {
	const current = currentSeason();
	if (current) {
		// Moves earlier seasons aside, without leaving "no repeats" pairs behind to shape the next test.
		db().prepare('DELETE FROM seasons WHERE id = ?').run(current.id);
	}
	const next = createSeason(name);
	expect(sealDraw(next, people.ann.id).ok).toBe(true);
	const sealed = season();
	for (const giver of pairs(sealed.id).keys()) revealMyDraw(sealed, giver);
	return sealed;
}

beforeAll(() => {
	setSetting('relay_delay_min', '0');
	setSetting('relay_delay_max', '0');
	const a = createHousehold('A');
	const b = createHousehold('B');
	const c = createHousehold('C');
	people = {
		ann: createPerson({ display_name: 'Ann Ash', kind: 'adult', household_id: a.id, is_admin: true, username: 'ann' }),
		abe: createPerson({ display_name: 'Abe Ash', kind: 'adult', household_id: a.id }),
		amy: createPerson({ display_name: 'Amy Ash', kind: 'kid', household_id: a.id }),
		ben: createPerson({ display_name: 'Ben Birch', kind: 'adult', household_id: b.id }),
		bea: createPerson({ display_name: 'Bea Birch', kind: 'adult', household_id: b.id }),
		bo: createPerson({ display_name: 'Bo Birch', kind: 'kid', household_id: b.id }),
		cal: createPerson({ display_name: 'Cal Cedar', kind: 'adult', household_id: c.id }),
		cat: createPerson({ display_name: 'Cat Cedar', kind: 'adult', household_id: c.id })
	};
	setGuardians(people.amy.id, [people.ann.id, people.abe.id]);
	setGuardians(people.bo.id, [people.ben.id, people.bea.id]);
});

describe('browsing the database or a backup', () => {
	it('shows no names in notices, even one about a person going to their Santa', () => {
		const sealed = freshSealedSeason('Sealed notices');
		const subject = people.ben;
		setListReady(sealed, subject, true);
		const santa = [...pairs(sealed.id)].find(([, receiver]) => receiver === subject.id)![0];
		expect(noticesFor(santa).some((notice) => notice.title === "Ben's list is ready")).toBe(true);

		// Full names and whole phrases, because a short name could appear by chance in encrypted text.
		const raw = JSON.stringify(db().prepare('SELECT * FROM notices').all());
		expect(raw).not.toContain('list is ready');
		for (const person of everyone()) {
			expect(raw).not.toContain(person.display_name);
		}
	});

	it('uses a different buyer tag each season, so last year cannot identify this year', () => {
		expect(giverTag(1, people.ann.id)).not.toBe(giverTag(2, people.ann.id));
	});

	it('does not record what kind of card someone was shown', () => {
		const sealed = season();
		const card = createAction(sealed.id, people.ann.id, { kind: 'list_ready', ready: true }, {
			title: 't', body: '', bullets: [], notes: [], confirmLabel: 'y', cancelLabel: 'n', editable: false
		});
		const row = db().prepare('SELECT kind FROM pending_actions WHERE id = ?').get(card.id) as { kind: string };
		expect(row.kind).toBe('card');
		expect(card.kind).toBe('list_ready');
	});
});

describe("the admin's view after the draw changes", () => {
	it('does not name who was asked to draw again', () => {
		const sealed = freshSealedSeason('Removal');
		expect(peopleWhoHaveNotDrawn(sealed.id)).toEqual([]);
		const before = pairs(sealed.id);
		const result = removeAfterSealing(sealed, people.cat.id, people.ann.id);
		expect(result.ok).toBe(true);
		const after = pairs(sealed.id);
		const changed = [...after].filter(([giver, receiver]) => before.get(giver) !== receiver);
		expect(changed.length).toBeGreaterThan(0);

		// Everyone had drawn, so the admin's list must stay empty, and shows only a count.
		expect(peopleWhoHaveNotDrawn(sealed.id)).toEqual([]);
		expect(peopleRedrawingCount(sealed.id)).toBe(changed.length);
		// The person who changed still gets to draw again.
		for (const [giver] of changed) expect(myRecipient(sealed.id, giver)).toBeNull();
	});

	it('keeps someone who had not drawn on the list, so they cannot be spotted vanishing from it', () => {
		const next = freshSealedSeason('Removal, not yet drawn');
		db().prepare('UPDATE assignments SET revealed_at = NULL WHERE season_id = ?').run(next.id);
		const waitingBefore = new Set(peopleWhoHaveNotDrawn(next.id));
		expect(waitingBefore.size).toBe(8);
		expect(removeAfterSealing(next, people.cat.id, people.ann.id).ok).toBe(true);
		waitingBefore.delete(people.cat.id);
		expect(new Set(peopleWhoHaveNotDrawn(next.id))).toEqual(waitingBefore);
		expect(peopleRedrawingCount(next.id)).toBe(0);
	});

	it('leaves everyone on the waiting list after a full redraw, which has no secret to protect', () => {
		const next = freshSealedSeason('Full redraw');
		expect(fullRedraw(next, 'Testing', people.ann.id).ok).toBe(true);
		expect(peopleWhoHaveNotDrawn(next.id)).toHaveLength(8);
		expect(drawProgress(next.id).revealed).toBe(0);
	});

	it('keeps the gift count steady, so a changed person does not reappear as having bought nothing', () => {
		const next = freshSealedSeason('Gift count');
		const buyer = [...pairs(next.id)].find(([, receiver]) => receiver === people.cat.id)?.[0];
		expect(buyer).toBeDefined();
		const item = addItem(next, people.cat.id, { title: 'Bought before the change' });
		expect(setItemBought(next.id, buyer!, item.id, true)).toBe(true);
		expect(peopleWithNoGift(next.id)).not.toContain(buyer);

		expect(removeAfterSealing(next, people.cat.id, people.ann.id).ok).toBe(true);
		expect(peopleWithNoGift(next.id)).not.toContain(buyer);
	});
});

describe('stale state after the draw changes', () => {
	it('closes answered threads, and stops old purchases counting as covered', () => {
		const next = freshSealedSeason('Stale state');
		const added = createPerson({ display_name: `Late Comer ${Date.now()}`, kind: 'adult' });
		const before = pairs(next.id);

		const buyers = [...before.keys()];
		const threads = new Map<number, string>();
		const items = new Map<number, number>();
		for (const buyer of buyers) {
			const subject = before.get(buyer)!;
			const threadId = askQuestion(next.id, buyer, 'Any favorite color?', 'person');
			deliverDueMessages();
			replyToBuyer(threadId, subject, 'Green');
			threads.set(buyer, threadId);
			const item = addItem(next, subject, { title: `Gift for ${subject}` });
			setItemBought(next.id, buyer, item.id, true);
			items.set(buyer, item.id);
		}

		expect(addAfterSealing(next, added.id, people.ann.id).ok).toBe(true);
		const after = pairs(next.id);
		const changed = buyers.filter((buyer) => after.get(buyer) !== before.get(buyer));
		expect(changed.length).toBeGreaterThan(0);

		for (const buyer of changed) {
			const subject = before.get(buyer)!;
			const thread = threadsAsBuyer(next.id, buyer).find((t) => t.id === threads.get(buyer));
			expect(thread?.status).toBe('closed');
			expect(coveredItemIds(next.id, subject)).not.toContain(items.get(buyer));
			revealMyDraw(next, buyer);
			expect(myGifts(next.id, buyer)).toEqual([]);
		}
	});

	it('refuses a card written about someone who is no longer their person', () => {
		const next = freshSealedSeason('Card subject');
		const buyer = people.ann;
		const current = myRecipient(next.id, buyer.id)!;
		const wrongSubject = everyone().find((person) => person.id !== current.id && person.id !== buyer.id)!;
		const card = createAction(next.id, buyer.id, { kind: 'send_question', route: 'person', subjectId: wrongSubject.id, text: 'Hi' }, {
			title: 'Question', body: 'Hi', bullets: [], notes: [], confirmLabel: 'Send', cancelLabel: 'No', editable: true
		});
		const result = decideAction(card.id, buyer, 'confirm');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.card.status).toBe('failed');
			expect(result.card.result).toContain('no longer applies');
		}
		expect(threadsAsBuyer(next.id, buyer.id)).toEqual([]);
	});
});

describe('adding someone late', () => {
	it('changes two people where possible, so nobody can deduce what the newcomer inherited', () => {
		const next = freshSealedSeason('Late add');
		const before = pairs(next.id);
		const added = createPerson({ display_name: `Another Late ${Date.now()}`, kind: 'adult' });
		const result = addAfterSealing(next, added.id, people.ann.id);
		expect(result).toMatchObject({ ok: true, changed: 2 });
		const after = pairs(next.id);
		expect(after.has(added.id)).toBe(true);
		const changed = [...before.keys()].filter((giver) => after.get(giver) !== before.get(giver));
		expect(changed).toHaveLength(2);
		db().prepare('UPDATE people SET active = 0 WHERE id = ?').run(added.id);
	});
});

describe('admin powers during a sealed draw', () => {
	it('refuses switching someone to a kid, which would let the admin open their draw', async () => {
		freshSealedSeason('Kind flip');
		const result = (await personActions.save(
			actionEvent(
				people.ann,
				{ name: 'Cal Cedar', kind: 'kid', household: '', guardians: String(people.ann.id), color: 'pine', is_admin: '' },
				{ id: String(people.cal.id) }
			)
		)) as { status?: number };
		expect(result.status).toBe(400);
		expect(db().prepare('SELECT kind FROM people WHERE id = ?').get(people.cal.id)).toEqual({ kind: 'adult' });
		expect(guardiansOf(people.cal.id)).toEqual([]);
	});

	it("tells the family when a kid's parents change", async () => {
		const sealed = freshSealedSeason('Guardian change');
		await personActions.save(
			actionEvent(
				people.ann,
				{ name: 'Bo Birch', kind: 'kid', household: '', guardians: [String(people.ben.id), String(people.ann.id)], color: 'pine' },
				{ id: String(people.bo.id) }
			)
		);
		for (const person of everyone()) {
			const alert = noticesFor(person.id).find((n) => n.season_id === sealed.id && n.title.includes("who can open Bo Birch's profile"));
			expect(alert, person.display_name).toBeDefined();
		}
		setGuardians(people.bo.id, [people.ben.id, people.bea.id]);
	});

	it('says nothing when a change makes no difference', async () => {
		const sealed = freshSealedSeason('No guardian change');
		await personActions.save(
			actionEvent(
				people.ann,
				{ name: 'Bo Birch', kind: 'kid', household: '', guardians: [String(people.ben.id), String(people.bea.id)], color: 'pine' },
				{ id: String(people.bo.id) }
			)
		);
		const alerts = noticesFor(people.ann.id).filter((n) => n.season_id === sealed.id && n.kind === 'alert');
		expect(alerts).toEqual([]);
	});

	it('tells the family when a reset link is used on an account in the draw', async () => {
		const sealed = freshSealedSeason('Password reset');
		db().prepare("UPDATE people SET password_hash = 'scrypt$1$a$b' WHERE id = ?").run(people.cal.id);
		const link = createInviteLink(people.cal.id, 'https://santa.test');
		await acceptInvite(link.split('/invite/')[1], 'a brand new password');
		for (const person of everyone()) {
			expect(noticesFor(person.id).some((n) => n.season_id === sealed.id && n.title === "Cal Cedar's password was reset")).toBe(true);
		}
	});
});

describe('archiving', () => {
	it('refuses a sealed season, and archiving could never publish one anyway', async () => {
		const sealed = freshSealedSeason('Archive guard');
		const result = (await seasonActions.archive(actionEvent(people.ann, {}))) as { status?: number };
		expect(result.status).toBe(409);
		expect(getSeason(sealed.id)?.status).toBe('sealed');

		// Even if the status changed some other way, the results stay hidden.
		setSeasonStatus(sealed.id, 'archived');
		expect(publishedResults(sealed.id)).toBeNull();
		setSeasonStatus(sealed.id, 'sealed');
	});

	it('refuses changes to a published season', () => {
		const sealed = freshSealedSeason('Published guard');
		setSeasonStatus(sealed.id, 'revealed');
		const published = season();
		expect(removeAfterSealing(published, people.cat.id, people.ann.id).ok).toBe(false);
		expect(fullRedraw(published, 'No', people.ann.id).ok).toBe(false);
	});

	it('stops reminders and countdowns from an archived season', async () => {
		const sealed = freshSealedSeason('Quiet archive');
		const id = createReminder({ seasonId: sealed.id, title: 'Late reminder', audience: 'everyone', fireAt: new Date(Date.now() - 1000).toISOString() });
		const countdown = createCountdown(sealed.id, { title: 'Past date', target_at: new Date(Date.now() - 1000).toISOString(), kind: 'custom' });
		setSeasonStatus(sealed.id, 'archived');
		await fireDueReminders();
		expect(getReminder(id)?.status).toBe('scheduled');
		expect(dueCountdowns().map((c) => c.id)).not.toContain(countdown);
		setSeasonStatus(sealed.id, 'sealed');
	});
});

describe('the emergency reveal', () => {
	it('cannot be hidden: its notice is undeletable and the count is kept per season', () => {
		const sealed = freshSealedSeason('Emergency');
		expect(getSeason(sealed.id)?.emergency_reveals).toBe(0);
		emergencyReveal(sealed, people.ann.id, 'Needed to check');
		expect(getSeason(sealed.id)?.emergency_reveals).toBe(1);

		const alert = noticesFor(people.ben.id).find((n) => n.title.includes('emergency reveal'))!;
		expect(deleteAnnouncement(alert.id)).toBe(false);
		expect(noticesFor(people.ben.id).some((n) => n.id === alert.id)).toBe(true);
		expect(familyAnnouncements().some((n) => n.id === alert.id)).toBe(false);

		const mine = postNotice({ seasonId: sealed.id, kind: 'info', title: 'Exchange moved to Saturday' });
		expect(familyAnnouncements().some((n) => n.id === mine)).toBe(true);
		expect(deleteAnnouncement(mine)).toBe(true);
	});
});

describe('whispers', () => {
	it("never reach the person they're about, even hidden in page data", () => {
		const sealed = freshSealedSeason('Whisper');
		setGuidance(people.cat.id, { notes: 'Size medium', helper_notes: 'Already got the telescope' });
		expect(getGuidance(people.cat.id).helper_notes).toBe('Already got the telescope');
		const data = myListLoad({ locals: { viewer: viewerFor(people.cat), sessionToken: null } } as never) as Record<string, unknown>;
		expect(JSON.stringify(data)).not.toContain('telescope');
		expect(JSON.stringify(data)).toContain('Size medium');
		expect(sealed.id).toBeGreaterThan(0);
	});
});

describe('wish list images', () => {
	it('only accepts images already copied to this server', () => {
		const sealed = season();
		const remote = addItem(sealed, people.cat.id, { title: 'Remote', image_url: 'https://tracker.example/pixel.png' });
		expect(remote.image_url).toBeNull();
		const local = addItem(sealed, people.cat.id, { title: 'Local', image_url: '/media/0123456789abcdef01234567.jpg' });
		expect(local.image_url).toBe('/media/0123456789abcdef01234567.jpg');
		const sneaky = addItem(sealed, people.cat.id, { title: 'Sneaky', image_url: '/media/../secret.key' });
		expect(sneaky.image_url).toBeNull();
	});
});

describe('anonymous timing', () => {
	it("doesn't move a thread or change its status until the follow-up actually arrives", () => {
		const sealed = freshSealedSeason('Timing');
		const buyer = [...pairs(sealed.id)].find(([, receiver]) => receiver === people.cal.id)![0];
		const threadId = askQuestion(sealed.id, buyer, 'First question', 'person');
		deliverDueMessages();
		replyToBuyer(threadId, people.cal.id, 'First answer');
		const answered = threadsAsAnswerer(sealed.id, people.cal.id).find((t) => t.id === threadId)!;
		expect(answered.status).toBe('answered');

		setSetting('relay_delay_min', '60');
		setSetting('relay_delay_max', '60');
		followUpFromBuyer(threadId, buyer, 'One more thing');
		const stillHidden = threadsAsAnswerer(sealed.id, people.cal.id).find((t) => t.id === threadId)!;
		expect(stillHidden.status).toBe('answered');
		expect(stillHidden.messages.some((m) => m.body === 'One more thing')).toBe(false);

		setSetting('relay_delay_min', '0');
		setSetting('relay_delay_max', '0');
		db().prepare(`UPDATE thread_messages SET deliver_at = ? WHERE thread_id = ? AND delivered_at IS NULL`).run(new Date(Date.now() - 1000).toISOString(), threadId);
		deliverDueMessages();
		const delivered = threadsAsAnswerer(sealed.id, people.cal.id).find((t) => t.id === threadId)!;
		expect(delivered.status).toBe('open');
		expect(delivered.messages.at(-1)?.body).toBe('One more thing');
	});
});

describe('mail that needs an answer', () => {
	it('stays up after being read, and only an answer clears it', () => {
		const sealed = freshSealedSeason('Waiting mail');
		const subject = people.cal;
		const buyer = [...pairs(sealed.id)].find(([, receiver]) => receiver === subject.id)![0];
		const threadId = askQuestion(sealed.id, buyer, 'What size shoes?', 'person');
		deliverDueMessages();

		expect(waitingOnMe(sealed.id, subject.id).map((m) => m.excerpt)).toEqual(['What size shoes?']);
		expect(mailBadgeCount(sealed.id, subject.id)).toBe(1);

		// Reading the mail and the notice changes nothing.
		markThreadRead(threadId, subject.id);
		markAllRead(subject.id);
		expect(waitingOnMe(sealed.id, subject.id)).toHaveLength(1);
		expect(mailBadgeCount(sealed.id, subject.id)).toBe(1);

		// Answering clears it for them, and gives the buyer one new answer to read.
		replyToBuyer(threadId, subject.id, 'Size 9');
		expect(waitingOnMe(sealed.id, subject.id)).toEqual([]);
		expect(mailBadgeCount(sealed.id, subject.id)).toBe(0);
		expect(mailBadgeCount(sealed.id, buyer)).toBe(1);
		markThreadRead(threadId, buyer);
		expect(mailBadgeCount(sealed.id, buyer)).toBe(0);

		// A follow-up puts it back up once it arrives.
		followUpFromBuyer(threadId, buyer, 'And width?');
		deliverDueMessages();
		expect(waitingOnMe(sealed.id, subject.id).map((m) => m.excerpt)).toEqual(['And width?']);
	});

	it('counts a new message once, not as both a notice and mail', () => {
		const sealed = freshSealedSeason('Single count');
		const subject = people.cal;
		const buyer = [...pairs(sealed.id)].find(([, receiver]) => receiver === subject.id)![0];
		markAllRead(subject.id);
		askQuestion(sealed.id, buyer, 'One question', 'person');
		deliverDueMessages();
		expect(noticesFor(subject.id).filter((n) => n.kind === 'mail' && !n.read)).toHaveLength(1);
		expect(unreadCount(subject.id)).toBe(0);
		expect(unreadPersonalCount(subject.id)).toBe(0);
		expect(mailBadgeCount(sealed.id, subject.id)).toBe(1);
	});

	it('keeps a permission slip up until someone decides, for each parent', () => {
		const sealed = freshSealedSeason('Waiting slip');
		const kid = people.amy;
		const buyer = [...pairs(sealed.id)].find(([, receiver]) => receiver === kid.id)![0];
		const outcome = requestApproval(sealed.id, buyer, { title: 'Drum kit', message: 'Is a drum kit OK?' });
		expect(outcome.outcome).toBe('sent');
		deliverDueMessages();
		expect(waitingOnMe(sealed.id, people.ann.id).map((m) => m.kind)).toEqual(['approval']);
		expect(waitingOnMe(sealed.id, people.abe.id)).toHaveLength(1);
		// The slip is not on the kid's own profile.
		expect(waitingOnMe(sealed.id, kid.id)).toEqual([]);

		if (outcome.outcome === 'sent') decideApproval(outcome.threadId, people.ann.id, true, '');
		expect(waitingOnMe(sealed.id, people.ann.id)).toEqual([]);
		expect(waitingOnMe(sealed.id, people.abe.id)).toEqual([]);
	});

	it('names no buyer in what is shown as waiting', () => {
		const sealed = freshSealedSeason('Waiting names');
		const subject = people.cal;
		const buyer = [...pairs(sealed.id)].find(([, receiver]) => receiver === subject.id)![0];
		askQuestion(sealed.id, buyer, 'A question', 'person');
		deliverDueMessages();
		const shown = JSON.stringify(waitingOnMe(sealed.id, subject.id));
		const buyerPerson = everyone().find((person) => person.id === buyer)!;
		expect(shown).not.toContain(buyerPerson.display_name);
		expect(shown).not.toContain(giverTag(sealed.id, buyer));
	});
});

describe('the checklist', () => {
	it('puts an unopened name first, then returns to the usual order', () => {
		const sealed = freshSealedSeason('Checklist order');
		const person = people.cal;
		db().prepare('UPDATE assignments SET revealed_at = NULL WHERE season_id = ? AND giver_id = ?').run(sealed.id, person.id);
		const before = homeTasks(sealed, person);
		expect(before[0].key).toBe('draw');
		expect(before[0].blocked).toBeFalsy();
		revealMyDraw(sealed, person.id);
		expect(homeTasks(sealed, person)[0].key).toBe('list');
	});
});

describe('moving a countdown', () => {
	it("replaces its unsent reminders, so none go out with the wrong date", () => {
		const sealed = freshSealedSeason('Move date');
		const target = new Date(Date.now() + 40 * 86_400_000).toISOString();
		const id = createCountdown(sealed.id, { title: 'Big day', target_at: target, kind: 'exchange' });
		planReminders(sealed.id, id);
		const original = listReminders(sealed.id).filter((r) => r.countdown_id === id);
		expect(original.length).toBe(3);

		db().prepare('UPDATE countdowns SET target_at = ? WHERE id = ?').run(new Date(Date.now() + 50 * 86_400_000).toISOString(), id);
		expect(removeScheduledFor(id)).toBe(3);
		planReminders(sealed.id, id);
		const moved = listReminders(sealed.id).filter((r) => r.countdown_id === id);
		expect(moved.length).toBe(3);
		expect(moved.map((r) => r.fire_at).sort()).not.toEqual(original.map((r) => r.fire_at).sort());
		expect(getCountdown(id)?.title).toBe('Big day');
	});
});

describe('editing a countdown on the admin page', () => {
	it('moves its reminders when the date changes, and leaves them alone otherwise', async () => {
		const sealed = freshSealedSeason('Route move');
		setSetting('timezone', 'UTC');
		const when = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 16);
		const id = createCountdown(sealed.id, { title: 'Big day', target_at: new Date(`${when(40)}:00Z`).toISOString(), kind: 'exchange' });
		planReminders(sealed.id, id);
		const original = listReminders(sealed.id).filter((r) => r.countdown_id === id).map((r) => r.fire_at);
		expect(original).toHaveLength(3);

		const save = (date: string) =>
			countdownActions.update(actionEvent(people.ann, { id: String(id), title: 'Big day', subtitle: '', when: date, kind: 'exchange', visible: 'on' })) as Promise<{ message: string }>;

		const same = await save(when(40));
		expect(same.message).toBe('Saved.');
		expect(listReminders(sealed.id).filter((r) => r.countdown_id === id).map((r) => r.fire_at)).toEqual(original);

		const moved = await save(when(50));
		expect(moved.message).toContain('reminders moved');
		const after = listReminders(sealed.id).filter((r) => r.countdown_id === id);
		expect(after).toHaveLength(3);
		expect(after.map((r) => r.fire_at).sort()).not.toEqual([...original].sort());
	});
});

describe('a full redraw with changes', () => {
	it('can remove or add someone when a small repair is impossible', () => {
		const sealed = freshSealedSeason('Redraw changes');
		expect(fullRedraw(sealed, 'Cat cannot come', people.ann.id, { remove: [people.cat.id] }).ok).toBe(true);
		expect(participantIds(sealed.id)).not.toContain(people.cat.id);
		expect(pairs(sealed.id).has(people.cat.id)).toBe(false);
		expect(fullRedraw(sealed, 'Cat can come after all', people.ann.id, { add: [people.cat.id] }).ok).toBe(true);
		expect(participantIds(sealed.id)).toContain(people.cat.id);
		expect(pairs(sealed.id).has(people.cat.id)).toBe(true);
	});
});

describe('the AI budget', () => {
	it('starts over each season', async () => {
		const sealed = freshSealedSeason('Budget one');
		recordUsage(null, 'chat', 'claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 0 }, 'end_turn');
		expect(totalSpend()).toBeGreaterThanOrEqual(4);
		setSeasonStatus(sealed.id, 'archived');
		await new Promise((resolve) => setTimeout(resolve, 15));
		createSeason('Budget two');
		expect(totalSpend()).toBe(0);
	});
});

describe('counting arrangements', () => {
	it('matches known answers', () => {
		const people4 = [1, 2, 3, 4];
		const people5 = [1, 2, 3, 4, 5];
		expect(countArrangements({ people: people4, forbidden: () => false })).toBe(9);
		expect(countArrangements({ people: people5, forbidden: () => false })).toBe(44);
		// With no two people allowed to draw each other, only the 24 five-person loops remain.
		expect(countArrangements({ people: people5, forbidden: () => false, noReciprocal: true })).toBe(24);
		expect(countArrangements({ people: [1, 2], forbidden: () => true })).toBe(0);
	});
	it('gives up rather than hanging on a very large family', () => {
		const many = Array.from({ length: 40 }, (_, i) => i);
		expect(countArrangements({ people: many, forbidden: () => false }, 100_000)).toBeNull();
	});
});

describe('login return addresses', () => {
	const origin = 'https://santa.test';
	it('allows paths on this site', () => {
		expect(safeReturnPath('/my-list', origin)).toBe('/my-list');
		expect(safeReturnPath('/mail?x=1', origin)).toBe('/mail?x=1');
	});
	it('refuses anything that could lead elsewhere', () => {
		for (const next of ['//evil.test', '/\t/evil.test/phish', '/\\evil.test', 'https://evil.test', '/\n/evil.test', '', null]) {
			expect(safeReturnPath(next, origin), String(next)).toBeNull();
		}
	});
});

describe('relayed links', () => {
	it('never passes along a link that could identify the buyer', () => {
		expect(cleanRelayUrl('https://a.co/d/abc123')).toBeNull();
		expect(cleanRelayUrl('https://amzn.to/xyz')).toBeNull();
		expect(cleanRelayUrl('https://www.amazon.com/hz/wishlist/ls/ABCDEF')).toBeNull();
		expect(cleanRelayUrl('https://www.amazon.com/Long-Product-Title/dp/B01ABCDEFG/ref=sr_1_1?crid=me&tag=x-20')).toBe('https://www.amazon.com/dp/B01ABCDEFG');
		expect(cleanRelayUrl('https://www.amazon.co.uk/gp/product/B01ABCDEFG')).toBe('https://www.amazon.co.uk/dp/B01ABCDEFG');
		expect(cleanRelayUrl('https://shop.example/ref=abc/thing/ref=def')).toBe('https://shop.example/thing');
	});
});

describe('private addresses', () => {
	it('blocks every IPv6 form except ordinary global addresses', () => {
		for (const ip of ['::127.0.0.1', 'fec0::1', '2002:7f00:1::', '::ffff:0:7f00:1', '64:ff9b::7f00:1', '2001:0:4136:e378::1', '2001:db8::1']) {
			expect(isPrivateAddress(ip), ip).toBe(true);
		}
		expect(isPrivateAddress('2a03:2880:f12f:83:face:b00c:0:25de')).toBe(false);
	});
});
