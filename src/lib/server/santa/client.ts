import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db';
import { anthropicKey } from '../env';
import { postNotice } from '../notices';
import { sendNtfy } from '../ntfy';
import { admins } from '../people';
import { publicUrl } from '../env';
import { currentSeason } from '../season';
import { getNumberSetting, getSetting, setSetting } from '../settings';

/** List prices per million tokens. The admin page labels totals as estimates. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
	'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
	'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
	'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }
};
const WEB_SEARCH_USD = 0.01;

export const MODEL_CHOICES = [
	{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best writing, about $4 / $20 per million tokens)' },
	{ id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (about $2 / $10 per million tokens)' },
	{ id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (cheapest, about $0.10 / $0.50 per million tokens)' }
] as const;

let client: Anthropic | null = null;

export function anthropic(): Anthropic | null {
	const key = anthropicKey();
	if (!key) return null;
	if (!client) client = new Anthropic({ apiKey: key, maxRetries: 2, timeout: 120_000 });
	return client;
}

export function santaModel(): string {
	return getSetting('santa_model');
}

export function santaEffort(): 'low' | 'medium' | 'high' {
	const value = getSetting('santa_effort');
	return value === 'medium' || value === 'high' ? value : 'low';
}

/**
 * Server-side fallback: if a safety classifier declines a request, the API retries it on a
 * suitable model inside the same call. Haiku has no such fallback.
 */
export function supportsFallback(model: string): boolean {
	return model === 'claude-opus-5-5' || model === 'claude-sonnet-5-5';
}

export function fallbackParams(model: string): { betas?: string[]; fallbacks?: 'default' } {
	return supportsFallback(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {};
}

export function webSearchToolType(model: string): 'web_search_20260209' | 'web_search_20250305' {
	return model === 'claude-haiku-5-5' ? 'web_search_20250305' : 'web_search_20260209';
}

export interface UsageLike {
	input_tokens?: number | null;
	output_tokens?: number | null;
	cache_read_input_tokens?: number | null;
	cache_creation_input_tokens?: number | null;
	server_tool_use?: { web_search_requests?: number | null } | null;
}

export function estimateCost(model: string, usage: UsageLike): number {
	const price = PRICES[model] ?? PRICES['claude-opus-5-5'];
	const searches = usage.server_tool_use?.web_search_requests ?? 0;
	return (
		((usage.input_tokens ?? 0) * price.input +
			(usage.output_tokens ?? 0) * price.output +
			(usage.cache_read_input_tokens ?? 0) * price.cacheRead +
			(usage.cache_creation_input_tokens ?? 0) * price.cacheWrite) /
			1_000_000 +
		searches * WEB_SEARCH_USD
	);
}

/**
 * Why a model call stopped: the API's own stop_reason (such as "end_turn", "refusal", "max_tokens"
 * or "pause_turn"), or "tool_rounds_exhausted" when a chat used up its tool rounds.
 */
export type StopReason = string | null | undefined;

export function recordUsage(personId: number | null, purpose: string, model: string, usage: UsageLike, stopReason: StopReason): void {
	db()
		.prepare(
			`INSERT INTO ai_usage (person_id, purpose, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, web_searches, cost_usd, stop_reason)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			personId,
			purpose,
			model,
			usage.input_tokens ?? 0,
			usage.output_tokens ?? 0,
			usage.cache_read_input_tokens ?? 0,
			usage.cache_creation_input_tokens ?? 0,
			usage.server_tool_use?.web_search_requests ?? 0,
			estimateCost(model, usage),
			stopReason ?? null
		);
}

/** The budget covers one season, so spending is counted from when the current one began. */
function spendSince(): string {
	return currentSeason()?.created_at ?? '';
}

export function totalSpend(): number {
	return (
		db().prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM ai_usage WHERE at >= ?').get(spendSince()) as { total: number }
	).total;
}

export interface SpendSummary {
	total: number;
	budget: number;
	calls: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	searches: number;
	byPurpose: { purpose: string; calls: number; cost: number }[];
	byModel: { model: string; calls: number; cost: number }[];
}

export function spendSummary(): SpendSummary {
	const since = spendSince();
	const totals = db()
		.prepare(
			`SELECT COALESCE(SUM(cost_usd), 0) AS total, COUNT(*) AS calls,
			 COALESCE(SUM(input_tokens), 0) AS inputTokens, COALESCE(SUM(output_tokens), 0) AS outputTokens,
			 COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens, COALESCE(SUM(web_searches), 0) AS searches
			 FROM ai_usage WHERE at >= ?`
		)
		.get(since) as Omit<SpendSummary, 'budget' | 'byPurpose' | 'byModel'>;
	return {
		...totals,
		budget: getNumberSetting('ai_budget_usd'),
		byPurpose: db()
			.prepare('SELECT purpose, COUNT(*) AS calls, SUM(cost_usd) AS cost FROM ai_usage WHERE at >= ? GROUP BY purpose ORDER BY cost DESC')
			.all(since) as SpendSummary['byPurpose'],
		byModel: db()
			.prepare('SELECT model, COUNT(*) AS calls, SUM(cost_usd) AS cost FROM ai_usage WHERE at >= ? GROUP BY model ORDER BY cost DESC')
			.all(since) as SpendSummary['byModel']
	};
}

/** This season's totals of the ways Santa can come up short. Counts only, with no names. */
export interface SantaOutcomes {
	/** Calls of any kind that the model declined. */
	declined: number;
	/** Calls cut off at their length limit. */
	cutOff: number;
	/** Chat messages that used up every tool round. */
	tangled: number;
	/** Chat messages that never reached the model, by reason. */
	blocked: { reason: string; count: number }[];
	/** Chat messages that failed with an error. */
	failed: number;
}

export function santaOutcomes(): SantaOutcomes {
	const since = spendSince();
	const stops = db()
		.prepare(
			`SELECT COALESCE(SUM(stop_reason = 'refusal'), 0) AS declined,
			 COALESCE(SUM(stop_reason = 'max_tokens'), 0) AS cutOff,
			 COALESCE(SUM(stop_reason = 'tool_rounds_exhausted'), 0) AS tangled
			 FROM ai_usage WHERE at >= ?`
		)
		.get(since) as { declined: number; cutOff: number; tangled: number };
	const blocked = db()
		.prepare(
			`SELECT detail AS reason, COUNT(*) AS count FROM audit_log
			 WHERE action = 'santa.blocked' AND at >= ? GROUP BY detail ORDER BY count DESC`
		)
		.all(since) as SantaOutcomes['blocked'];
	const failed = (
		db().prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'santa.failed' AND at >= ?`).get(since) as { n: number }
	).n;
	return { ...stops, blocked, failed };
}

export function overBudget(): boolean {
	return totalSpend() >= getNumberSetting('ai_budget_usd');
}

/** Warns the admin once when the budget runs out. The game keeps working without AI. */
export async function warnIfOverBudget(): Promise<void> {
	if (!overBudget() || getSetting('ai_budget_warned') === '1') return;
	setSetting('ai_budget_warned', '1');
	const season = currentSeason();
	for (const admin of admins()) {
		postNotice({
			seasonId: season?.id,
			personId: admin.id,
			kind: 'alert',
			title: 'Santa has used up his AI budget',
			body: 'Santa chat is paused. Everything else still works. You can raise the budget in Settings.',
			link: '/admin/settings'
		});
	}
	await sendNtfy({
		title: 'Santa has used up his AI budget',
		message: 'Santa chat is paused. Tap to change the budget.',
		click: `${publicUrl()}/admin/settings`,
		tags: ['warning']
	});
}

export function aiAvailable(): boolean {
	return !!anthropicKey() && getSetting('santa_enabled') === '1' && !overBudget();
}

export function chatsToday(personId: number): number {
	const since = new Date(Date.now() - 86_400_000).toISOString();
	return (
		db()
			.prepare(`SELECT COUNT(*) AS n FROM chat_turns WHERE person_id = ? AND role = 'user' AND created_at >= ?`)
			.get(personId, since) as { n: number }
	).n;
}

export function dailyCapReached(personId: number): boolean {
	return chatsToday(personId) >= getNumberSetting('santa_daily_cap');
}
