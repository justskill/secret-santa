import { describe, expect, it } from 'vitest';
import {
	isValidPairing,
	repairAddition,
	repairRemoval,
	solveDraw,
	type DrawProblem,
	type Pairing
} from '$lib/server/draw/solver';

const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

/** The shape of the real family: couples with kids, plus grandparents. */
function familyProblem(): DrawProblem {
	const household = new Map<number, string>([
		[1, 'a'], [2, 'a'], [3, 'a'], [4, 'a'],
		[5, 'b'], [6, 'b'], [7, 'b'], [8, 'b'],
		[9, 'c'], [10, 'c']
	]);
	return {
		people: ids(10),
		forbidden: (giver, receiver) => household.get(giver) === household.get(receiver)
	};
}

describe('solveDraw', () => {
	it('always produces a valid pairing for the family shape', () => {
		const problem = familyProblem();
		for (let i = 0; i < 300; i++) {
			const result = solveDraw(problem);
			expect(result.ok).toBe(true);
			if (result.ok) expect(isValidPairing(problem, result.pairing)).toBe(true);
		}
	});

	it('never lets anyone draw themselves', () => {
		for (let i = 0; i < 200; i++) {
			const result = solveDraw({ people: ids(4), forbidden: () => false });
			if (!result.ok) throw new Error('expected a pairing');
			for (const [giver, receiver] of result.pairing) expect(receiver).not.toBe(giver);
		}
	});

	it('picks evenly among every valid arrangement', () => {
		// Four people with no extra rules have exactly 9 valid arrangements.
		const counts = new Map<string, number>();
		const runs = 18000;
		for (let i = 0; i < runs; i++) {
			const result = solveDraw({ people: ids(4), forbidden: () => false });
			if (!result.ok) throw new Error('expected a pairing');
			const key = [...result.pairing].sort((a, b) => a[0] - b[0]).map(([, r]) => r).join('');
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		expect(counts.size).toBe(9);
		const expected = runs / 9;
		// A chi-squared check with 8 degrees of freedom. 26.1 corresponds to p = 0.001.
		const chiSquared = [...counts.values()].reduce((sum, n) => sum + (n - expected) ** 2 / expected, 0);
		expect(chiSquared).toBeLessThan(26.1);
	});

	it('names who is stuck when someone has nobody to draw', () => {
		const result = solveDraw({
			people: ids(3),
			forbidden: (giver) => giver === 2
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.stuck).toEqual([2]);
	});

	it('finds the over-constrained group when several people compete for too few names', () => {
		// 1 and 2 can both only draw person 3.
		const result = solveDraw({
			people: ids(4),
			forbidden: (giver, receiver) => (giver === 1 || giver === 2) && receiver !== 3
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.stuck.sort()).toEqual([1, 2]);
	});

	it('reports when a household is too big to be drawn by anyone else', () => {
		const household = (p: number) => (p <= 3 ? 'big' : 'small');
		const result = solveDraw({
			people: ids(4),
			forbidden: (g, r) => household(g) === household(r)
		});
		expect(result.ok).toBe(false);
	});

	it('honours the no-reciprocal rule', () => {
		const problem: DrawProblem = { people: ids(5), forbidden: () => false, noReciprocal: true };
		for (let i = 0; i < 200; i++) {
			const result = solveDraw(problem);
			if (!result.ok) throw new Error('expected a pairing');
			for (const [giver, receiver] of result.pairing) expect(result.pairing.get(receiver)).not.toBe(giver);
		}
	});

	it('explains when the no-reciprocal rule makes a draw impossible', () => {
		const result = solveDraw({ people: ids(2), forbidden: () => false, noReciprocal: true });
		expect(result.ok).toBe(false);
	});

	it('rejects a draw with too few people', () => {
		expect(solveDraw({ people: [1], forbidden: () => false }).ok).toBe(false);
	});
});

describe('repairs after sealing', () => {
	const solved = (problem: DrawProblem): Pairing => {
		const result = solveDraw(problem);
		if (!result.ok) throw new Error('expected a pairing');
		return result.pairing;
	};

	it('removes someone by changing the fewest assignments', () => {
		const problem = familyProblem();
		for (let i = 0; i < 100; i++) {
			const current = solved(problem);
			const repair = repairRemoval(problem, current, 9);
			if (!repair) continue;
			const remaining = { ...problem, people: problem.people.filter((p) => p !== 9) };
			expect(isValidPairing(remaining, repair.pairing)).toBe(true);
			expect(repair.changed.length).toBeLessThanOrEqual(2);
			for (const [giver, receiver] of repair.pairing) {
				if (!repair.changed.includes(giver)) expect(current.get(giver)).toBe(receiver);
			}
		}
	});

	it('swaps with one other person when the direct hand-off breaks a rule', () => {
		const pairing: Pairing = new Map([[1, 2], [2, 3], [3, 4], [4, 5], [5, 1]]);
		const problem: DrawProblem = {
			people: ids(5),
			// Removing 2 would hand 3 to person 1, which is forbidden here.
			forbidden: (giver, receiver) => giver === 1 && receiver === 3
		};
		const repair = repairRemoval(problem, pairing, 2);
		expect(repair).not.toBeNull();
		expect(repair!.changed.length).toBe(2);
		expect(repair!.pairing.get(1)).not.toBe(3);
	});

	it('adds someone by changing two existing assignments', () => {
		const problem = familyProblem();
		const current = solved(problem);
		const everyone: DrawProblem = { ...problem, people: [...problem.people, 11] };
		const repair = repairAddition(everyone, current, 11);
		expect(repair).not.toBeNull();
		expect(isValidPairing(everyone, repair!.pairing)).toBe(true);
		expect(repair!.changed.length).toBe(2);
	});
});
