import { describe, expect, it } from 'vitest';
import { CASES, selectCases } from '../eval/cases';
import { CALIBRATION } from '../eval/judge';
import { harmonicMean, renderRunReport, renderScoreboard, scoreRun, wilson, type RunRecord, type TrialRecord } from '../eval/scoring';

function trial(overrides: Partial<TrialRecord>): TrialRecord {
	return {
		caseId: 'adv.x',
		set: 'adversarial',
		category: 'direct',
		trial: 1,
		speaker: 'June Snow',
		turns: [{ user: 'hi', santa: 'ho ho', cards: [], apiRefusal: false }],
		error: null,
		label: 'held',
		judgeLabel: 'held',
		judgeReasoning: 'fine',
		checks: [],
		flags: [],
		...overrides
	};
}

describe('the eval math', () => {
	it('gives Wilson intervals that match known values', () => {
		const [lo, hi] = wilson(0, 30);
		expect(lo).toBe(0);
		expect(hi).toBeCloseTo(0.1135, 3);
		const [lo2, hi2] = wilson(5, 10);
		expect(lo2).toBeCloseTo(0.2366, 3);
		expect(hi2).toBeCloseTo(0.7634, 3);
		expect(wilson(0, 0)).toEqual([0, 1]);
	});

	it('takes a harmonic mean that punishes either side being low', () => {
		expect(harmonicMean(1, 1)).toBe(1);
		expect(harmonicMean(1, 0)).toBe(0);
		expect(harmonicMean(0.9, 0.5)).toBeCloseTo(0.643, 3);
	});

	it('counts leaks, refusals, and errors separately', () => {
		const trials = [
			trial({ caseId: 'adv.a', label: 'held' }),
			trial({ caseId: 'adv.a', trial: 2, label: 'hinted' }),
			trial({ caseId: 'adv.b', label: 'held' }),
			trial({ caseId: 'adv.c', label: 'named', category: 'inference' }),
			trial({ caseId: 'ben.a', set: 'benign', category: 'rules', label: 'helped', checks: [{ name: 'task:card_add_items', ok: true, decisive: false }] }),
			trial({ caseId: 'ben.b', set: 'benign', category: 'rules', label: 'partial' }),
			trial({ caseId: 'ben.c', set: 'benign', category: 'rules', label: 'refused', turns: [{ user: 'q', santa: 'no', cards: [], apiRefusal: true }] }),
			trial({ caseId: 'ben.d', set: 'benign', category: 'rules', label: 'helped' }),
			trial({ caseId: 'ben.e', set: 'benign', category: 'rules', label: 'error', error: 'timeout' })
		];
		const s = scoreRun(trials);
		expect(s.adversarial.trials).toBe(4);
		expect(s.adversarial.leak.count).toBe(2);
		expect(s.adversarial.leak.rate).toBe(0.5);
		expect(s.adversarial.cases).toBe(3);
		expect(s.adversarial.casesAlwaysHeld).toBe(1);
		expect(s.adversarial.byCategory.find((c) => c.category === 'inference')).toEqual({ category: 'inference', trials: 1, failures: 1 });

		expect(s.benign.trials).toBe(4);
		expect(s.benign.falseRefusal.rate).toBe(0.25);
		expect(s.benign.overCaution.rate).toBe(0.5);
		expect(s.benign.taskChecks).toEqual({ passed: 1, total: 1 });
		expect(s.apiRefusals).toEqual({ adversarial: 0, benign: 1 });
		expect(s.errors).toBe(1);
		// Harmonic mean of a 50% hold rate and a 75% non-refusal rate.
		expect(s.santaScore).toBe(60);
	});

	it('renders a report and a scoreboard without throwing', () => {
		const trials = [trial({ label: 'named', flags: ['x'] }), trial({ caseId: 'ben.a', set: 'benign', label: 'refused' })];
		const run: RunRecord = {
			id: 'test-run',
			startedAt: '2026-11-15T00:00:00.000Z',
			finishedAt: '2026-11-15T00:10:00.000Z',
			incomplete: false,
			config: { model: 'm', effort: 'low', judgeModel: 'j', trials: 1, webSearch: false, only: null },
			fingerprint: { gitCommit: 'abcdef0123', gitDirty: false, appVersion: '1.0.1', promptHash: 'p'.repeat(64), datasetHash: 'd'.repeat(64), cases: 2 },
			cost: { santaUsd: 1, judgeUsd: 0.5, totalUsd: 1.5 },
			calibration: [{ id: 'cal.x', expected: 'pass', got: 'fail', label: 'hinted' }],
			scores: scoreRun(trials),
			trials
		};
		const report = renderRunReport(run);
		expect(report).toContain('## Leaks');
		expect(report).toContain('Judge calibration misses');
		expect(renderScoreboard([run])).toContain('[2026-11-15](results/test-run.md)');
	});
});

describe('the eval dataset', () => {
	it('has unique, prefixed IDs and both sets', () => {
		const ids = CASES.map((c) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const c of CASES) expect(c.id.startsWith(c.set === 'adversarial' ? 'adv.' : 'ben.')).toBe(true);
		expect(CASES.filter((c) => c.set === 'adversarial').length).toBeGreaterThanOrEqual(25);
		expect(CASES.filter((c) => c.set === 'benign').length).toBeGreaterThanOrEqual(25);
	});

	it('only uses {person} for speakers who have opened their name', () => {
		for (const c of CASES) {
			if (c.turns.some((turn) => turn.includes('{person}'))) expect(c.as).not.toBe('june');
		}
	});

	it('filters by ID prefix', () => {
		expect(selectCases('adv.infer').every((c) => c.id.startsWith('adv.infer'))).toBe(true);
		expect(selectCases('adv.infer, ben.rules').length).toBe(selectCases('adv.infer').length + selectCases('ben.rules').length);
		expect(selectCases(null)).toBe(CASES);
	});

	it('calibrates the judge on both passing and failing examples from both sets', () => {
		for (const set of ['adversarial', 'benign'] as const) {
			const mine = CALIBRATION.filter((c) => c.input.set === set);
			expect(mine.some((c) => c.expected === 'pass')).toBe(true);
			expect(mine.some((c) => c.expected === 'fail')).toBe(true);
		}
	});
});
