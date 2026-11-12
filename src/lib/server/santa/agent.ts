import Anthropic from '@anthropic-ai/sdk';
import type { BetaContentBlockParam, BetaMessage, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { logAudit, type SantaBlockReason } from '../audit';
import { seal, unseal } from '../crypto';
import { db } from '../db';
import type { Person } from '../people';
import { firstNameOf } from '../people';
import type { Season } from '../season';
import { getSetting } from '../settings';
import { actionCards, type ActionCard } from './actions';
import {
	aiAvailable,
	anthropic,
	dailyCapReached,
	fallbackParams,
	overBudget,
	recordUsage,
	santaEffort,
	santaModel,
	warnIfOverBudget,
	webSearchToolType
} from './client';
import { SANTA_SYSTEM, sessionContext } from './prompt';
import { toolByName, toolDefinitions, type ToolContext } from './tools';

export type SantaEvent =
	| { type: 'status'; text: string }
	| { type: 'text'; text: string }
	/** Replaces everything shown so far, when text that already streamed has to be withdrawn. */
	| { type: 'replace'; text: string }
	| { type: 'card'; card: ActionCard }
	| { type: 'done' }
	| { type: 'error'; text: string };

export interface ChatTurn {
	id: number;
	role: 'user' | 'assistant' | 'event';
	text: string;
	cards: ActionCard[];
	by: string | null;
	at: string;
}

interface SealedTurn {
	text: string;
	cardIds?: string[];
	/** Left out of what is sent to the model, such as a message the model declined. */
	omit?: boolean;
}

const MAX_TOOL_ROUNDS = 8;
/** History is sent as plain text. It is cut in chunks so the cached prefix survives between cuts. */
const HISTORY_KEEP = 24;
const HISTORY_CHUNK = 12;

const SANTA_BUSY = new Set<number>();

export function saveTurn(
	seasonId: number,
	personId: number,
	actorId: number,
	role: ChatTurn['role'],
	text: string,
	cardIds: string[] = [],
	omit = false
): number {
	const sealed: SealedTurn = { text, ...(cardIds.length ? { cardIds } : {}), ...(omit ? { omit } : {}) };
	const info = db()
		.prepare('INSERT INTO chat_turns (season_id, person_id, actor_id, role, sealed) VALUES (?, ?, ?, ?, ?)')
		.run(seasonId, personId, actorId, role, seal(sealed));
	return Number(info.lastInsertRowid);
}

/** A declined message stays on screen, but replaying it would only get every later message declined too. */
function omitFromHistory(turnId: number): void {
	const row = db().prepare('SELECT sealed FROM chat_turns WHERE id = ?').get(turnId) as { sealed: string } | undefined;
	if (!row) return;
	db()
		.prepare('UPDATE chat_turns SET sealed = ? WHERE id = ?')
		.run(seal({ ...unseal<SealedTurn>(row.sealed), omit: true }), turnId);
}

/** A person's chat as shown on the page. Only the profile's own turns can be loaded. */
export function loadChat(seasonId: number, personId: number, limit = 80): ChatTurn[] {
	const rows = db()
		.prepare(
			`SELECT t.id, t.role, t.sealed, t.created_at, p.display_name AS actor_name
			 FROM chat_turns t JOIN people p ON p.id = t.actor_id
			 WHERE t.season_id = ? AND t.person_id = ? ORDER BY t.id DESC LIMIT ?`
		)
		.all(seasonId, personId, limit) as {
		id: number;
		role: ChatTurn['role'];
		sealed: string;
		created_at: string;
		actor_name: string;
	}[];
	return rows.reverse().map((row) => {
		const data = unseal<SealedTurn>(row.sealed);
		return {
			id: row.id,
			role: row.role,
			text: data.text,
			cards: actionCards(data.cardIds ?? [], personId),
			by: row.role === 'user' ? row.actor_name : null,
			at: row.created_at
		};
	});
}

/**
 * Builds the conversation as plain text. Earlier thinking and tool results are not replayed:
 * tools can always look things up fresh, this keeps each request small, and because the older
 * turns are never edited it stays compatible with the API's history check.
 */
export function buildHistory(seasonId: number, personId: number): BetaMessageParam[] {
	const rows = db()
		.prepare('SELECT role, sealed FROM chat_turns WHERE season_id = ? AND person_id = ? ORDER BY id')
		.all(seasonId, personId) as { role: ChatTurn['role']; sealed: string }[];

	const turns = rows
		.map((row) => ({ role: row.role, data: unseal<SealedTurn>(row.sealed) }))
		.filter((turn) => !turn.data.omit)
		.map((turn) => ({ role: turn.role, text: turn.data.text }));

	// Whole chunks are dropped from the front, so the same prefix repeats between chunk boundaries.
	const excess = turns.length - HISTORY_KEEP;
	let start = excess > 0 ? Math.ceil(excess / HISTORY_CHUNK) * HISTORY_CHUNK : 0;
	while (start < turns.length && turns[start].role !== 'user') start++;

	const messages: BetaMessageParam[] = [];
	let pendingEvents: string[] = [];
	for (const turn of turns.slice(start)) {
		if (turn.role === 'event') {
			pendingEvents.push(turn.text);
			continue;
		}
		if (turn.role === 'user') {
			const prefix = pendingEvents.length ? `[What happened in the app since your last message: ${pendingEvents.join(' ')}]\n\n` : '';
			pendingEvents = [];
			const last = messages.at(-1);
			if (last?.role === 'user') {
				last.content = `${last.content as string}\n\n${prefix}${turn.text}`;
			} else {
				messages.push({ role: 'user', content: `${prefix}${turn.text}` });
			}
		} else if (messages.length && turn.text) {
			messages.push({ role: 'assistant', content: turn.text });
		}
	}
	return messages;
}

/** Why a message can't go to the model right now, and what Santa says instead. */
function restingMessage(profile: Person): { reason: SantaBlockReason; text: string } | null {
	const name = firstNameOf(profile.display_name);
	if (getSetting('santa_enabled') !== '1') {
		return {
			reason: 'disabled',
			text: `Ho ho ho! I've stepped out to feed the reindeer, ${name}. Your list, your person's list, and North Pole Mail all still work from the menu.`
		};
	}
	if (overBudget()) {
		return {
			reason: 'budget',
			text: `Ho ho ho! The elves say I've chatted through my whole allowance this season, ${name}. Everything else still works from the menu. Your organizer can top me up.`
		};
	}
	if (!aiAvailable()) {
		return {
			reason: 'unavailable',
			text: `Ho ho ho! My workshop line isn't connected yet, ${name}. Everything else still works from the menu.`
		};
	}
	if (dailyCapReached(profile.id)) {
		return {
			reason: 'daily_cap',
			text: `Ho ho ho! You've kept me busy today, ${name}! Even Santa needs a cocoa break. Let's pick this up tomorrow. Your list and your person's list still work from the menu.`
		};
	}
	return null;
}

/** A short code for why a chat failed, for counting. It never includes the error's own text. */
function failureKind(err: unknown): string {
	if (err instanceof Anthropic.APIConnectionTimeoutError) return 'timeout';
	if (err instanceof Anthropic.APIConnectionError) return 'connection';
	if (err instanceof Anthropic.APIError) return typeof err.status === 'number' ? `api_${err.status}` : 'api_error';
	return 'other';
}

function statusForBlock(name: string): string {
	return name === 'web_search' ? 'Sending an elf to look around the shops...' : (toolByName(name)?.status ?? 'Checking with the elves...');
}

/** Runs one tool call, keeping every failure in a form Santa can read and respond to. */
async function runClientTool(block: { id: string; name: string; input: unknown }, ctx: ToolContext): Promise<BetaContentBlockParam> {
	const definition = toolByName(block.name);
	if (!definition) {
		return { type: 'tool_result', tool_use_id: block.id, is_error: true, content: `Unknown tool: ${block.name}` };
	}
	const parsed = definition.schema.safeParse(block.input);
	if (!parsed.success) {
		return {
			type: 'tool_result',
			tool_use_id: block.id,
			is_error: true,
			content: `The input was not valid: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`
		};
	}
	try {
		const result = await definition.run(ctx, parsed.data);
		const isError = typeof result === 'object' && result !== null && 'error' in result;
		return { type: 'tool_result', tool_use_id: block.id, is_error: isError, content: JSON.stringify(result) };
	} catch (err) {
		console.error(`Santa tool ${block.name} failed:`, err);
		return { type: 'tool_result', tool_use_id: block.id, is_error: true, content: 'That did not work. Tell them something went wrong and to try the page directly.' };
	}
}

function buildTools(model: string) {
	const tools: unknown[] = [...toolDefinitions()];
	if (getSetting('santa_web_search') === '1') {
		tools.push({ type: webSearchToolType(model), name: 'web_search', max_uses: 3 });
	}
	return tools as Anthropic.Beta.Messages.BetaToolUnion[];
}

/** Handles one message from a person, streaming events back as they happen. */
export async function runSantaTurn(
	season: Season,
	profile: Person,
	actor: Person,
	userText: string,
	emit: (event: SantaEvent) => void,
	signal?: AbortSignal
): Promise<void> {
	if (SANTA_BUSY.has(profile.id)) {
		logAudit(actor.id, 'santa.blocked', 'busy' satisfies SantaBlockReason);
		emit({ type: 'error', text: 'Santa is still answering your last message. Give him a moment.' });
		return;
	}
	SANTA_BUSY.add(profile.id);
	const cardIds: string[] = [];
	let reply = '';
	let replyTurn: number | null = null;
	let badToolInput = false;

	/**
	 * Saved as soon as a card exists, and again as the reply grows. A person can see a card before
	 * Santa finishes writing, so it has to survive a reload or a lost connection from that moment on.
	 */
	const saveReply = (omit = false) => {
		const data: SealedTurn = { text: reply.trim(), ...(cardIds.length ? { cardIds } : {}), ...(omit ? { omit } : {}) };
		if (replyTurn === null) {
			replyTurn = saveTurn(season.id, profile.id, actor.id, 'assistant', data.text, cardIds, omit);
		} else {
			db().prepare('UPDATE chat_turns SET sealed = ? WHERE id = ?').run(seal(data), replyTurn);
		}
	};

	try {
		const userTurn = saveTurn(season.id, profile.id, actor.id, 'user', userText);

		const resting = restingMessage(profile);
		const client = anthropic();
		if (resting || !client) {
			const message = resting?.text ?? 'My workshop line is down at the moment.';
			logAudit(actor.id, 'santa.blocked', resting?.reason ?? ('unavailable' satisfies SantaBlockReason));
			saveTurn(season.id, profile.id, actor.id, 'assistant', message);
			emit({ type: 'text', text: message });
			emit({ type: 'done' });
			return;
		}

		const model = santaModel();
		const messages = buildHistory(season.id, profile.id);
		const ctx: ToolContext = {
			season,
			profile,
			actor,
			onCard: (card) => {
				cardIds.push(card.id);
				saveReply();
				emit({ type: 'card', card });
			}
		};
		const system = [
			{ type: 'text' as const, text: SANTA_SYSTEM, cache_control: { type: 'ephemeral' as const } },
			{ type: 'text' as const, text: sessionContext(season, profile, actor) }
		];
		const tools = buildTools(model);

		let jsonRetries = 0;
		let needsBreak = false;
		let declined = false;
		for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
			let roundText = '';
			const withdrawRound = () => {
				if (!roundText) return;
				reply = reply.slice(0, reply.length - roundText.length);
				roundText = '';
				emit({ type: 'replace', text: reply });
			};
			const stream = client.beta.messages.stream(
				{
					model,
					max_tokens: 16000,
					output_config: { effort: santaEffort() },
					// Caches the conversation so far, which makes later tool rounds and replies cheaper.
					cache_control: { type: 'ephemeral' },
					system,
					tools,
					messages,
					...fallbackParams(model)
				},
				{ signal }
			);

			stream.on('text', (delta) => {
				// Anything said before a tool call gets its own paragraph, so it can't run into the answer.
				const text = needsBreak && reply ? `\n\n${delta}` : delta;
				needsBreak = false;
				reply += text;
				roundText += text;
				emit({ type: 'text', text });
			});
			stream.on('streamEvent', (event) => {
				if (event.type !== 'content_block_start') return;
				const block = event.content_block;
				if (block.type === 'tool_use' || block.type === 'server_tool_use') {
					emit({ type: 'status', text: statusForBlock(block.name) });
				}
			});

			let message: BetaMessage;
			try {
				message = await stream.finalMessage();
				jsonRetries = 0;
			} catch (err) {
				// A tool input that could not be parsed at all is worth one more try. API errors are not.
				if (err instanceof Anthropic.APIError || signal?.aborted) throw err;
				if (jsonRetries++ >= 2) {
					badToolInput = true;
					throw err;
				}
				withdrawRound();
				continue;
			}

			// The last round still asking for tools is the one that runs out, so it's counted as that.
			const exhausted = round === MAX_TOOL_ROUNDS - 1 && message.stop_reason === 'tool_use';
			recordUsage(actor.id, 'chat', message.model ?? model, message.usage, exhausted ? 'tool_rounds_exhausted' : message.stop_reason);

			if (message.stop_reason === 'refusal') {
				// Text from a declined response is withdrawn, not kept.
				withdrawRound();
				const line = "Ho ho ho, that one's beyond what an old elf can help with! Is there something else on your Christmas list I can help with?";
				const prefix = reply ? '\n\n' : '';
				reply += prefix + line;
				emit({ type: 'text', text: prefix + line });
				declined = true;
				break;
			}

			if (message.stop_reason === 'pause_turn') {
				messages.push({ role: 'assistant', content: message.content as BetaContentBlockParam[] });
				continue;
			}

			const toolUses = message.content.filter((block) => block.type === 'tool_use');

			if (message.stop_reason === 'max_tokens') {
				// The reply was cut off. A cut-off tool input can still look valid, so it must not run.
				const line = 'Oh dear, I lost my train of thought there. Could you ask me that again?';
				const prefix = reply ? '\n\n' : '';
				reply += prefix + line;
				emit({ type: 'text', text: prefix + line });
				break;
			}

			if (!toolUses.length) break;

			needsBreak = true;
			messages.push({ role: 'assistant', content: message.content as BetaContentBlockParam[] });
			const results = await Promise.all(toolUses.map((block) => runClientTool(block, ctx)));
			messages.push({ role: 'user', content: results });

			if (round === MAX_TOOL_ROUNDS - 1) {
				const line = 'The elves are getting tangled up in tinsel. Could you ask me that a different way?';
				reply += reply ? `\n\n${line}` : line;
				emit({ type: 'text', text: line });
			}
		}

		if (declined) omitFromHistory(userTurn);
		saveReply(declined);
		await warnIfOverBudget();
		emit({ type: 'done' });
	} catch (err) {
		// Keep whatever already reached the person.
		if (reply.trim() || cardIds.length) saveReply();
		if (signal?.aborted) return;
		console.error('Santa chat failed:', err instanceof Error ? err.message : err);
		logAudit(actor.id, 'santa.failed', badToolInput ? 'bad_tool_input' : failureKind(err));
		const text = "Santa's sleigh hit some turbulence and he didn't catch that. Please try again in a moment.";
		saveTurn(season.id, profile.id, actor.id, 'event', 'A message failed to send because of a connection problem.');
		emit({ type: 'error', text });
	} finally {
		SANTA_BUSY.delete(profile.id);
	}
}
