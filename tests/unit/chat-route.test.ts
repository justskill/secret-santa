import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let finishTurn: () => void = () => {};

// A stand-in for Santa that is still replying until the test lets it finish.
vi.mock('$lib/server/santa/agent', () => ({
	runSantaTurn: vi.fn((_season, _profile, _actor, _text, emit: (event: unknown) => void) => {
		emit({ type: 'text', text: 'Ho ho' });
		return new Promise<void>((resolve) => {
			finishTurn = resolve;
		});
	})
}));

const { POST } = await import('../../src/routes/api/santa/chat/+server');
const { createPerson } = await import('$lib/server/people');
const { createSeason } = await import('$lib/server/season');

let person: ReturnType<typeof createPerson>;
const rejections: unknown[] = [];
const onRejection = (reason: unknown) => rejections.push(reason);

beforeAll(() => {
	person = createPerson({ display_name: 'Tab Closer', kind: 'adult' });
	createSeason('Chat route');
	process.on('unhandledRejection', onRejection);
});

afterEach(() => {
	rejections.length = 0;
});

function call() {
	return POST({
		request: new Request('http://test/api/santa/chat', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ message: 'Hello' })
		}),
		locals: { viewer: { account: person, profile: person, wards: [], isAdmin: false }, sessionToken: null }
	} as never) as Promise<Response>;
}

describe('the chat stream', () => {
	it('survives the browser going away while Santa is still replying', async () => {
		const response = await call();
		const reader = response.body!.getReader();
		await reader.read();

		// This is what happens when someone closes the tab or loses signal.
		await reader.cancel();
		finishTurn();
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(rejections).toEqual([]);
	});

	it('finishes normally when the browser stays connected', async () => {
		const response = await call();
		const reader = response.body!.getReader();
		const first = await reader.read();
		expect(new TextDecoder().decode(first.value)).toContain('Ho ho');
		finishTurn();
		const end = await reader.read();
		expect(end.done).toBe(true);
		expect(rejections).toEqual([]);
	});
});
