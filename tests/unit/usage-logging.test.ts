import Anthropic from '@anthropic-ai/sdk';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A stand-in for the Anthropic API. Each chat round takes the next queued reply (or error), and each
 * writing job takes the next queued parse result. Nothing here reaches the real API.
 */
const fake = vi.hoisted(() => ({
	aiOn: true,
	streams: [] as unknown[],
	parses: [] as unknown[]
}));

vi.mock('$lib/server/santa/client', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/santa/client')>();
	return {
		...actual,
		aiAvailable: () => fake.aiOn,
		anthropic: () => ({
			beta: {
				messages: {
					stream: () => {
						const next = fake.streams.shift();
						return {
							on: () => undefined,
							finalMessage: async () => {
								const value = await next;
								if (value instanceof Error) throw value;
								if (value === undefined) throw new Error('The test queued no reply for this round.');
								return value;
							}
						};
					},
					parse: async () => fake.parses.shift()
				}
			}
		})
	};
});

import { forgetActivityMemoForTests, isoWeek, noteActive } from '$lib/server/activity';
import {
	COUNTED_EVENTS,
	logAudit,
	logUnsignedEvent,
	recentAudit,
	resetUnsignedEventCountsForTests,
	UNSIGNED_EVENT_DAILY_CAP
} from '$lib/server/audit';
import { clearThrottleForTests } from '$lib/server/auth';
import { hashPassword } from '$lib/server/crypto';
import { db } from '$lib/server/db';
import { createPerson, setPasswordHash, type Person } from '$lib/server/people';
import { runSantaTurn, type SantaEvent } from '$lib/server/santa/agent';
import { santaOutcomes } from '$lib/server/santa/client';
import { draftReminderText, extractWishItems, MAX_PASTE, rewriteForRelay } from '$lib/server/santa/writing';
import { createSeason, currentSeason, type Season } from '$lib/server/season';
import { setSetting } from '$lib/server/settings';
import { POST as chatPost } from '../../src/routes/api/santa/chat/+server';
import { actions as loginActions } from '../../src/routes/login/+page.server';

let season: Season;
let person: Person;
const PASSWORD = 'candy-cane-42';

const usage = { input_tokens: 100, output_tokens: 20 };

function reply(stopReason: string, content: unknown[] = [{ type: 'text', text: 'Ho ho ho!' }]) {
	return { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: stopReason, content, usage };
}

function toolCall(round: number) {
	return reply('tool_use', [{ type: 'tool_use', id: `toolu_${round}`, name: 'not_a_real_tool', input: {} }]);
}

async function chat(text = 'Hello Santa', signal?: AbortSignal): Promise<SantaEvent[]> {
	const events: SantaEvent[] = [];
	await runSantaTurn(season, person, person, text, (event) => events.push(event), signal);
	return events;
}

function usageRows() {
	return db().prepare('SELECT person_id, purpose, stop_reason FROM ai_usage ORDER BY id').all() as {
		person_id: number | null;
		purpose: string;
		stop_reason: string | null;
	}[];
}

function auditRows(action?: string) {
	return db()
		.prepare(`SELECT actor_id, action, detail FROM audit_log ${action ? 'WHERE action = ?' : ''} ORDER BY id`)
		.all(...(action ? [action] : [])) as { actor_id: number | null; action: string; detail: string }[];
}

beforeAll(async () => {
	person = createPerson({ display_name: 'Pat Logger', kind: 'adult', username: 'patlogger' });
	setPasswordHash(person.id, await hashPassword(PASSWORD));
	createSeason('Counting season');
	season = currentSeason()!;
});

beforeEach(() => {
	db().exec('DELETE FROM ai_usage; DELETE FROM audit_log; DELETE FROM chat_turns; DELETE FROM activity_weeks;');
	fake.aiOn = true;
	fake.streams.length = 0;
	fake.parses.length = 0;
	setSetting('santa_enabled', '1');
	setSetting('ai_budget_usd', '40');
	setSetting('santa_daily_cap', '40');
	clearThrottleForTests();
	resetUnsignedEventCountsForTests();
	forgetActivityMemoForTests();
});

describe('why each model call stopped', () => {
	it('stores a refusal', async () => {
		fake.streams.push(reply('refusal', []));
		await chat();
		expect(usageRows()).toEqual([{ person_id: person.id, purpose: 'chat', stop_reason: 'refusal' }]);
	});

	it('stores a normal finish and a cut-off', async () => {
		fake.streams.push(reply('end_turn'));
		await chat();
		fake.streams.push(reply('max_tokens'));
		await chat('Tell me a very long story');
		expect(usageRows().map((row) => row.stop_reason)).toEqual(['end_turn', 'max_tokens']);
	});

	it('marks the round that runs out of tool rounds, and only that one', async () => {
		for (let round = 0; round < 8; round++) fake.streams.push(toolCall(round));
		const events = await chat();
		const stops = usageRows().map((row) => row.stop_reason);
		expect(stops).toHaveLength(8);
		expect(stops.slice(0, 7)).toEqual(Array(7).fill('tool_use'));
		expect(stops[7]).toBe('tool_rounds_exhausted');
		expect(events.some((event) => event.type === 'text' && event.text.includes('tangled up in tinsel'))).toBe(true);
	});

	it('stores why each writing job stopped, still without a person on relay rewrites', async () => {
		fake.parses.push({ stop_reason: 'refusal', parsed_output: null, usage });
		const relay = await rewriteForRelay({ text: 'Does she like blue?', purpose: 'question_to_person', senderName: person.display_name });
		expect(relay.rewritten).toBe(false);

		fake.parses.push({ stop_reason: 'end_turn', parsed_output: { items: [] }, usage });
		await extractWishItems('A red scarf', person.id);

		fake.parses.push({ stop_reason: 'max_tokens', parsed_output: null, usage });
		await draftReminderText({ title: 'Lists are due', audience: 'everyone', link: 'https://santa.test', familyName: 'Logger' });

		expect(usageRows()).toEqual([
			{ person_id: null, purpose: 'relay_rewrite', stop_reason: 'refusal' },
			{ person_id: person.id, purpose: 'list_extract', stop_reason: 'end_turn' },
			{ person_id: null, purpose: 'reminder_draft', stop_reason: 'max_tokens' }
		]);
	});
});

describe('chat blocks', () => {
	const cases: [string, () => void][] = [
		['disabled', () => setSetting('santa_enabled', '0')],
		['budget', () => setSetting('ai_budget_usd', '0')],
		['unavailable', () => (fake.aiOn = false)],
		['daily_cap', () => setSetting('santa_daily_cap', '0')]
	];

	for (const [reason, arrange] of cases) {
		it(`writes one row for "${reason}"`, async () => {
			arrange();
			await chat('A secret wish for a pony');
			expect(auditRows()).toEqual([{ actor_id: person.id, action: 'santa.blocked', detail: reason }]);
			expect(usageRows()).toEqual([]);
		});
	}

	it('writes one row for a second message sent while Santa is still answering', async () => {
		let release!: (value: unknown) => void;
		fake.streams.push(new Promise((resolve) => (release = resolve)));
		const first = chat();
		const second = await chat('Are you there?');
		expect(second).toEqual([{ type: 'error', text: expect.stringContaining('still answering') }]);
		release(reply('end_turn'));
		await first;
		expect(auditRows()).toEqual([{ actor_id: person.id, action: 'santa.blocked', detail: 'busy' }]);
	});
});

describe('chat failures', () => {
	it('records an API error by its status code', async () => {
		fake.streams.push(new Anthropic.APIError(529, undefined, 'Overloaded', undefined));
		const events = await chat();
		expect(events.at(-1)?.type).toBe('error');
		expect(auditRows()).toEqual([{ actor_id: person.id, action: 'santa.failed', detail: 'api_529' }]);
	});

	it('records a timeout', async () => {
		fake.streams.push(new Anthropic.APIConnectionTimeoutError());
		await chat();
		expect(auditRows('santa.failed').map((row) => row.detail)).toEqual(['timeout']);
	});

	it('records tool input that could not be read after every retry', async () => {
		fake.streams.push(new Error('Unexpected end of JSON input'), new Error('again'), new Error('and again'));
		await chat();
		expect(auditRows('santa.failed').map((row) => row.detail)).toEqual(['bad_tool_input']);
	});

	it('does not count someone closing the tab as a failure', async () => {
		const abort = new AbortController();
		abort.abort();
		fake.streams.push(new Error('Request was aborted.'));
		await chat('Hello', abort.signal);
		expect(auditRows('santa.failed')).toEqual([]);
	});
});

describe('truncation', () => {
	async function postChat(message: string) {
		const response = (await chatPost({
			request: new Request('http://test/api/santa/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message })
			}),
			locals: { viewer: { account: person, profile: person, wards: [], isAdmin: false }, sessionToken: null }
		} as never)) as Response;
		await response.text();
	}

	it('records the length of a chat message that was cut, and nothing else', async () => {
		fake.aiOn = false;
		const long = `  ${'Dear Santa, '.repeat(200)}  `;
		await postChat(long);
		const detail = String(long.trim().length);
		expect(detail).toBe('2399');
		expect(auditRows('santa.truncated')).toEqual([{ actor_id: person.id, action: 'santa.truncated', detail }]);
	});

	it('ignores a message that fits once its spaces are trimmed', async () => {
		fake.aiOn = false;
		await postChat(`   ${'a'.repeat(2000)}   `);
		expect(auditRows('santa.truncated')).toEqual([]);
	});

	it('records the length of a pasted wish list that was cut', async () => {
		fake.parses.push({ stop_reason: 'end_turn', parsed_output: { items: [] }, usage });
		await extractWishItems('x'.repeat(MAX_PASTE + 500), person.id);
		fake.parses.push({ stop_reason: 'end_turn', parsed_output: { items: [] }, usage });
		await extractWishItems('x'.repeat(MAX_PASTE), person.id);
		expect(auditRows('list.truncated')).toEqual([{ actor_id: person.id, action: 'list.truncated', detail: String(MAX_PASTE + 500) }]);
	});
});

describe('sign-ins', () => {
	async function login(username: string, password: string): Promise<{ status?: number }> {
		const form = new FormData();
		form.set('username', username);
		form.set('password', password);
		try {
			return (await loginActions.default!({
				request: new Request('https://santa.test/login', { method: 'POST', body: form }),
				cookies: { set: () => undefined },
				url: new URL('https://santa.test/login'),
				getClientAddress: () => '203.0.113.7'
			} as never)) as { status?: number };
		} catch (thrown) {
			// A successful sign-in ends in a redirect.
			return thrown as { status?: number };
		}
	}

	it('records a successful sign-in with who it was', async () => {
		expect((await login('patlogger', PASSWORD)).status).toBe(303);
		expect(auditRows()).toEqual([{ actor_id: person.id, action: 'login.ok', detail: '' }]);
	});

	it('records a failed sign-in without the name that was typed', async () => {
		expect((await login('Aunt Marjorie', 'not-it')).status).toBe(400);
		expect(auditRows()).toEqual([{ actor_id: null, action: 'login.failed', detail: '' }]);
		expect(JSON.stringify(auditRows())).not.toContain('Marjorie');
	});

	it('does not count an empty form', async () => {
		await login('', '');
		expect(auditRows()).toEqual([]);
	});

	it('counts a lockout once, however many tries it turns away', async () => {
		for (let i = 0; i < 8; i++) await login('patlogger', 'wrong guess');
		for (let i = 0; i < 3; i++) expect((await login('patlogger', 'wrong guess')).status).toBe(429);
		expect(auditRows('login.failed')).toHaveLength(8);
		expect(auditRows('login.throttled')).toEqual([{ actor_id: null, action: 'login.throttled', detail: '' }]);
	});

	it('stops writing failed sign-ins past the daily cap', () => {
		for (let i = 0; i < UNSIGNED_EVENT_DAILY_CAP + 5; i++) logUnsignedEvent('login.failed');
		expect(auditRows('login.failed')).toHaveLength(UNSIGNED_EVENT_DAILY_CAP);
	});
});

describe('weekly activity', () => {
	it('names weeks the ISO way, in UTC', () => {
		expect(isoWeek(new Date('2026-11-12T12:00:00Z'))).toBe('2026-W46');
		expect(isoWeek(new Date('2026-11-15T23:59:00Z'))).toBe('2026-W46');
		expect(isoWeek(new Date('2026-11-16T00:00:00Z'))).toBe('2026-W47');
		expect(isoWeek(new Date('2026-12-31T12:00:00Z'))).toBe('2026-W53');
		expect(isoWeek(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53');
		expect(isoWeek(new Date('2027-01-04T00:00:00Z'))).toBe('2027-W01');
	});

	it('keeps one row per person per week, with no time of day', () => {
		noteActive(person.id, new Date('2026-11-16T09:00:00Z'));
		noteActive(person.id, new Date('2026-11-18T21:30:00Z'));
		forgetActivityMemoForTests(); // as after a restart
		noteActive(person.id, new Date('2026-11-19T08:00:00Z'));
		noteActive(person.id, new Date('2026-11-24T08:00:00Z'));
		expect(db().prepare('SELECT * FROM activity_weeks ORDER BY week').all()).toEqual([
			{ person_id: person.id, week: '2026-W47' },
			{ person_id: person.id, week: '2026-W48' }
		]);
	});
});

describe('the admin dashboard', () => {
	it('leaves counted events out of recent activity', () => {
		logAudit(person.id, 'season.created', 'Counting season');
		for (const action of COUNTED_EVENTS) logAudit(person.id, action);
		expect(recentAudit(12).map((entry) => entry.action)).toEqual(['season.created']);
	});

	it('totals the ways Santa came up short this season', async () => {
		fake.streams.push(reply('refusal', []));
		await chat();
		fake.streams.push(reply('max_tokens'));
		await chat();
		fake.streams.push(new Anthropic.APIConnectionError({ message: 'down' }));
		await chat();
		setSetting('santa_daily_cap', '0');
		await chat();
		await chat();
		expect(santaOutcomes()).toEqual({
			declined: 1,
			cutOff: 1,
			tangled: 0,
			blocked: [{ reason: 'daily_cap', count: 2 }],
			failed: 1
		});
	});
});
