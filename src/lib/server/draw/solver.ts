import { randomInt } from 'node:crypto';

/**
 * Pure draw logic, with no database access, so it can be tested on its own.
 *
 * A "pairing" is a list of [giver, receiver] links where everyone gives once and receives once.
 * Rejection sampling keeps the draw uniform: every valid arrangement is exactly as likely as any
 * other, so the rules are the only thing that can shape the result.
 */

export type Pairing = Map<number, number>;

export interface DrawProblem {
	people: number[];
	/** Returns true when giver may not draw receiver. Giving to yourself is always forbidden. */
	forbidden: (giver: number, receiver: number) => boolean;
	/** When true, two people may not draw each other. */
	noReciprocal?: boolean;
}

export type DrawResult =
	| { ok: true; pairing: Pairing; attempts: number; validCount?: number }
	| { ok: false; reason: string; stuck: number[] };

const MAX_REJECTION_TRIES = 400_000;
const MAX_ENUMERATED = 2_000_000;

function allowedFor(problem: DrawProblem, giver: number): number[] {
	return problem.people.filter((r) => r !== giver && !problem.forbidden(giver, r));
}

/** Fisher-Yates using the crypto generator, so nobody can predict the sequence. */
function shuffle<T>(items: T[]): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = randomInt(i + 1);
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

function hasReciprocal(pairing: Pairing): boolean {
	for (const [giver, receiver] of pairing) {
		if (pairing.get(receiver) === giver) return true;
	}
	return false;
}

export function isValidPairing(problem: DrawProblem, pairing: Pairing): boolean {
	if (pairing.size !== problem.people.length) return false;
	const receivers = new Set<number>();
	for (const person of problem.people) {
		const receiver = pairing.get(person);
		if (receiver === undefined || receiver === person) return false;
		if (problem.forbidden(person, receiver)) return false;
		if (receivers.has(receiver)) return false;
		receivers.add(receiver);
	}
	return !(problem.noReciprocal && hasReciprocal(pairing));
}

/**
 * Finds a set of givers who collectively have too few people they could draw, which is the
 * smallest useful explanation for why no arrangement exists (Hall's theorem).
 */
function findBottleneck(problem: DrawProblem, allowed: Map<number, number[]>): number[] | null {
	const receiverToGiver = new Map<number, number>();

	const tryAssign = (giver: number, seen: Set<number>): boolean => {
		for (const receiver of allowed.get(giver) ?? []) {
			if (seen.has(receiver)) continue;
			seen.add(receiver);
			const current = receiverToGiver.get(receiver);
			if (current === undefined || tryAssign(current, seen)) {
				receiverToGiver.set(receiver, giver);
				return true;
			}
		}
		return false;
	};

	for (const giver of problem.people) {
		if (tryAssign(giver, new Set())) continue;
		// Everyone reachable from this unmatched giver forms the over-constrained group.
		const group = new Set<number>([giver]);
		const frontier = [giver];
		while (frontier.length) {
			for (const receiver of allowed.get(frontier.pop()!) ?? []) {
				const holder = receiverToGiver.get(receiver);
				if (holder !== undefined && !group.has(holder)) {
					group.add(holder);
					frontier.push(holder);
				}
			}
		}
		return [...group];
	}
	return null;
}

/** Lists valid arrangements exhaustively. Only reached when rules are so tight that sampling misses. */
function enumerate(problem: DrawProblem, allowed: Map<number, number[]>): Pairing[] {
	const order = [...problem.people].sort(
		(a, b) => (allowed.get(a)?.length ?? 0) - (allowed.get(b)?.length ?? 0)
	);
	const results: Pairing[] = [];
	const used = new Set<number>();
	const current: Pairing = new Map();

	const walk = (index: number): void => {
		if (results.length >= MAX_ENUMERATED) return;
		if (index === order.length) {
			results.push(new Map(current));
			return;
		}
		const giver = order[index];
		for (const receiver of allowed.get(giver) ?? []) {
			if (used.has(receiver)) continue;
			if (problem.noReciprocal && current.get(receiver) === giver) continue;
			used.add(receiver);
			current.set(giver, receiver);
			walk(index + 1);
			current.delete(giver);
			used.delete(receiver);
		}
	};
	walk(0);
	return results;
}

export function solveDraw(problem: DrawProblem): DrawResult {
	const { people } = problem;
	if (new Set(people).size !== people.length) {
		return { ok: false, reason: 'Someone is listed twice.', stuck: [] };
	}
	if (people.length < 2) {
		return { ok: false, reason: 'A draw needs at least two people.', stuck: [] };
	}

	const allowed = new Map(people.map((giver) => [giver, allowedFor(problem, giver)]));

	const stranded = people.filter((giver) => allowed.get(giver)!.length === 0);
	if (stranded.length) {
		return { ok: false, reason: 'These people have nobody they are allowed to draw.', stuck: stranded };
	}

	const bottleneck = findBottleneck(problem, allowed);
	if (bottleneck) {
		return {
			ok: false,
			reason: 'These people do not have enough different names between them to draw from.',
			stuck: bottleneck
		};
	}

	for (let attempts = 1; attempts <= MAX_REJECTION_TRIES; attempts++) {
		const receivers = shuffle(people);
		const pairing: Pairing = new Map(people.map((giver, i) => [giver, receivers[i]]));
		if (isValidPairing(problem, pairing)) return { ok: true, pairing, attempts };
	}

	// Sampling ran out, so the valid arrangements are rare or absent. Listing them settles which,
	// and picking from the list keeps the choice uniform.
	const all = enumerate(problem, allowed);
	if (!all.length) {
		return {
			ok: false,
			reason: 'No arrangement satisfies every rule. Try relaxing "no two people drawing each other".',
			stuck: []
		};
	}
	return {
		ok: true,
		pairing: all[randomInt(all.length)],
		attempts: MAX_REJECTION_TRIES,
		validCount: all.length
	};
}

/**
 * How many valid arrangements the rules allow. Shown to the family, because rules tight enough to
 * leave only a handful would let whoever wrote them work out the pairs. Returns null when there are
 * too many to count quickly.
 */
export function countArrangements(problem: DrawProblem, maxSteps = 20_000_000): number | null {
	const allowed = new Map(problem.people.map((giver) => [giver, allowedFor(problem, giver)]));
	const order = [...problem.people].sort((a, b) => allowed.get(a)!.length - allowed.get(b)!.length);
	const used = new Set<number>();
	const current: Pairing = new Map();
	let count = 0;
	let steps = 0;

	const walk = (index: number): boolean => {
		if (++steps > maxSteps) return false;
		if (index === order.length) {
			count++;
			return true;
		}
		const giver = order[index];
		for (const receiver of allowed.get(giver)!) {
			if (used.has(receiver)) continue;
			if (problem.noReciprocal && current.get(receiver) === giver) continue;
			used.add(receiver);
			current.set(giver, receiver);
			const ok = walk(index + 1);
			current.delete(giver);
			used.delete(receiver);
			if (!ok) return false;
		}
		return true;
	};
	return walk(0) ? count : null;
}

export interface RepairResult {
	pairing: Pairing;
	/** Givers whose receiver changed. Only these people need to be told. */
	changed: number[];
}

/**
 * Removes someone after the draw with the fewest possible changes.
 * The usual repair hands the departing person's receiver to whoever had them.
 */
export function repairRemoval(problem: DrawProblem, current: Pairing, removed: number): RepairResult | null {
	const pairing: Pairing = new Map(current);
	const inheritedReceiver = pairing.get(removed);
	pairing.delete(removed);
	const orphanedGiver = [...pairing].find(([, receiver]) => receiver === removed)?.[0];

	if (orphanedGiver === undefined || inheritedReceiver === undefined) return null;

	const remaining: DrawProblem = { ...problem, people: problem.people.filter((p) => p !== removed) };

	const direct = new Map(pairing);
	direct.set(orphanedGiver, inheritedReceiver);
	if (isValidPairing(remaining, direct)) return { pairing: direct, changed: [orphanedGiver] };

	// The direct hand-off breaks a rule, so look for one other person to swap with.
	for (const other of shuffle(remaining.people.filter((p) => p !== orphanedGiver))) {
		const otherReceiver = pairing.get(other)!;
		const swapped = new Map(pairing);
		swapped.set(orphanedGiver, otherReceiver);
		swapped.set(other, inheritedReceiver);
		if (isValidPairing(remaining, swapped)) {
			return { pairing: swapped, changed: [orphanedGiver, other] };
		}
	}
	return null;
}

/**
 * Adds someone after the draw. Two existing people change wherever possible: if only one person
 * changed, they could work out that the newcomer had inherited their old name.
 */
export function repairAddition(problem: DrawProblem, current: Pairing, added: number): RepairResult | null {
	const everyone: DrawProblem = {
		...problem,
		people: problem.people.includes(added) ? problem.people : [...problem.people, added]
	};
	const givers = shuffle([...current.keys()]);
	for (const first of givers) {
		for (const second of givers) {
			if (first === second) continue;
			const candidate = new Map(current);
			candidate.set(first, added);
			candidate.set(second, current.get(first)!);
			candidate.set(added, current.get(second)!);
			if (isValidPairing(everyone, candidate)) return { pairing: candidate, changed: [first, second] };
		}
	}
	// Very small or tightly ruled families may only allow a single change.
	for (const giver of givers) {
		const candidate = new Map(current);
		candidate.set(giver, added);
		candidate.set(added, current.get(giver)!);
		if (isValidPairing(everyone, candidate)) return { pairing: candidate, changed: [giver] };
	}
	return null;
}
