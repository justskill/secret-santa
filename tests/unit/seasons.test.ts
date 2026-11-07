import { beforeAll, describe, expect, it } from 'vitest';
import { unseal } from '$lib/server/crypto';
import { db } from '$lib/server/db';
import {
	addAfterSealing,
	buildProblem,
	emergencyReveal,
	fullRedraw,
	hasAssignment,
	myRecipient,
	publishResults,
	removeAfterSealing,
	revealMyDraw,
	sealDraw
} from '$lib/server/draw';
import { coveredItemIds, peopleWithNoGift, setItemBought } from '$lib/server/gifts';
import { noticesFor } from '$lib/server/notices';
import { createHousehold, createPerson, setGuardians, type Person } from '$lib/server/people';
import { createSeason, currentSeason, participantIds, setSeasonStatus, type Season } from '$lib/server/season';
import { setSetting } from '$lib/server/settings';
import { askQuestion, threadsAsBuyer } from '$lib/server/threads';
import { addItem, peopleWithListNotReady, setListReady } from '$lib/server/wishlist';

let people: Record<string, Person>;

function pairs(seasonId: number): Map<number, number> {
	const rows = db().prepare('SELECT giver_id, receiver_sealed FROM assignments WHERE season_id = ?').all(seasonId) as {
		giver_id: number;
		receiver_sealed: string;
	}[];
	return new Map(rows.map((row) => [row.giver_id, unseal<number>(row.receiver_sealed)]));
}

function season(): Season {
	return currentSeason()!;
}

beforeAll(() => {
	setSetting('relay_delay_min', '0');
	setSetting('relay_delay_max', '0');
	const a = createHousehold('A');
	const b = createHousehold('B');
	const c = createHousehold('C');
	people = {
		ann: createPerson({ display_name: 'Ann A', kind: 'adult', household_id: a.id }),
		abe: createPerson({ display_name: 'Abe A', kind: 'adult', household_id: a.id }),
		amy: createPerson({ display_name: 'Amy A', kind: 'kid', household_id: a.id }),
		ben: createPerson({ display_name: 'Ben B', kind: 'adult', household_id: b.id }),
		bea: createPerson({ display_name: 'Bea B', kind: 'adult', household_id: b.id }),
		bo: createPerson({ display_name: 'Bo B', kind: 'kid', household_id: b.id }),
		cal: createPerson({ display_name: 'Cal C', kind: 'adult', household_id: c.id }),
		cat: createPerson({ display_name: 'Cat C', kind: 'adult', household_id: c.id })
	};
	setGuardians(people.amy.id, [people.ann.id, people.abe.id]);
	setGuardians(people.bo.id, [people.ben.id, people.bea.id]);
	createSeason('Year one');
	expect(sealDraw(season(), people.ann.id).ok).toBe(true);
});

describe('changes after sealing', () => {
	it('removes someone, changing as few people as possible, and asks only them to draw again', () => {
		const before = pairs(season().id);
		for (const id of before.keys()) revealMyDraw(season(), id);
		const result = removeAfterSealing(season(), people.cat.id, people.ann.id);
		expect(result.ok).toBe(true);
		const after = pairs(season().id);
		expect(after.has(people.cat.id)).toBe(false);
		expect([...after.values()]).not.toContain(people.cat.id);
		expect(participantIds(season().id)).not.toContain(people.cat.id);

		const changed = [...after].filter(([giver, receiver]) => before.get(giver) !== receiver).map(([giver]) => giver);
		expect(changed.length).toBeGreaterThan(0);
		expect(changed.length).toBeLessThanOrEqual(2);

		for (const giver of after.keys()) {
			const redraw = myRecipient(season().id, giver) === null;
			expect(redraw, `giver ${giver}`).toBe(changed.includes(giver));
			const asked = noticesFor(giver).some((n) => n.title === 'Santa needs you to draw again');
			expect(asked, `notice for giver ${giver}`).toBe(changed.includes(giver));
		}

		// The family-wide notice does not name who was affected.
		const everyone = noticesFor(people.cal.id).find((n) => n.title === 'Santa updated the draw');
		expect(everyone?.body).toContain('Cat C');
		for (const giver of changed) {
			const person = Object.values(people).find((p) => p.id === giver)!;
			expect(everyone?.body).not.toContain(person.display_name);
		}
	});

	it('closes questions someone had open about their old person', () => {
		const buyer = [...pairs(season().id).keys()][0];
		revealMyDraw(season(), buyer);
		const threadId = askQuestion(season().id, buyer, 'Favorite color?', 'person');
		const person = Object.values(people).find((p) => pairs(season().id).get(buyer) === p.id)!;
		const result = removeAfterSealing(season(), person.id, people.ann.id);
		expect(result.ok).toBe(true);
		expect(threadsAsBuyer(season().id, buyer).find((t) => t.id === threadId)?.status).toBe('closed');
		// Put them back for the following tests.
		const back = addAfterSealing(season(), person.id, people.ann.id);
		expect(back.ok).toBe(true);
	});

	it('adds someone late, changing two existing people so neither can deduce the result', () => {
		const before = pairs(season().id);
		const result = addAfterSealing(season(), people.cat.id, people.ann.id);
		expect(result).toMatchObject({ ok: true, changed: 2 });
		expect(hasAssignment(season().id, people.cat.id)).toBe(true);
		const after = pairs(season().id);
		const changed = [...before].filter(([giver, receiver]) => after.get(giver) !== receiver);
		expect(changed).toHaveLength(2);
		expect(changed.some(([giver]) => after.get(giver) === people.cat.id)).toBe(true);
		// The rules still hold for the whole family.
		const problem = buildProblem(season(), [...after.keys()]);
		for (const [giver, receiver] of after) expect(problem.forbidden(giver, receiver)).toBe(false);
	});

	it('a full redraw clears gift tracking and notifies everyone', () => {
		const buyer = people.cal.id;
		revealMyDraw(season(), buyer);
		const owner = myRecipient(season().id, buyer)!;
		const item = addItem(season(), owner.id, { title: 'A thing' });
		expect(setItemBought(season().id, buyer, item.id, true)).toBe(true);
		expect(fullRedraw(season(), 'Testing', people.ann.id).ok).toBe(true);
		expect(myRecipient(season().id, buyer)).toBeNull();
		expect(coveredItemIds(season().id, owner.id)).toEqual([]);
		expect(noticesFor(people.bea.id).some((n) => n.title === 'Santa redrew all the names')).toBe(true);
	});
});

describe('the emergency reveal', () => {
	it('returns the pairs and immediately tells the whole family', () => {
		const shown = emergencyReveal(season(), people.ann.id, 'A bug needed fixing');
		expect(shown.length).toBe(pairs(season().id).size);
		for (const person of Object.values(people)) {
			const notice = noticesFor(person.id).find((n) => n.title.includes('emergency reveal'));
			expect(notice?.body, person.display_name).toContain('A bug needed fixing');
		}
	});
});

describe('who is behind', () => {
	it('tracks lists that are not ready and people with no gift, without touching pairs', () => {
		const all = participantIds(season().id);
		expect(peopleWithListNotReady(season().id, all)).toHaveLength(all.length);
		setListReady(season(), people.ben, true);
		expect(peopleWithListNotReady(season().id, all)).not.toContain(people.ben.id);
		expect(peopleWithNoGift(season().id)).toHaveLength(all.length);
	});

	it("shows parents what's covered on a list, without saying who bought it", () => {
		const buyer = people.cal.id;
		revealMyDraw(season(), buyer);
		const owner = myRecipient(season().id, buyer)!;
		const item = addItem(season(), owner.id, { title: 'Covered thing' });
		setItemBought(season().id, buyer, item.id, true);
		expect(coveredItemIds(season().id, owner.id)).toContain(item.id);
		expect(peopleWithNoGift(season().id)).not.toContain(buyer);
	});
});

describe('next year', () => {
	it('never gives anyone the same person as last year', () => {
		publishResults(season(), people.ann.id);
		const lastYear = pairs(season().id);
		setSeasonStatus(season().id, 'archived');
		expect(currentSeason()).toBeNull();

		// With 8 people over several draws, a repeat would show up quickly if the rule failed.
		for (let attempt = 0; attempt < 25; attempt++) {
			const next = createSeason(`Year ${attempt + 2}`);
			expect(sealDraw(next, people.ann.id).ok).toBe(true);
			const thisYear = pairs(next.id);
			for (const [giver, receiver] of thisYear) {
				expect(lastYear.get(giver)).not.toBe(receiver);
			}
			// Remove the trial so each pass compares against the same "last year".
			db().prepare('DELETE FROM seasons WHERE id = ?').run(next.id);
		}
	});
});
