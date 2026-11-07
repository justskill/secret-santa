import { randomInt } from 'node:crypto';
import { randomId, seal, unseal } from './crypto';
import { smsLink } from '$lib/sms';
import { db, nowIso, tx } from './db';
import { giverTag, myRecipient } from './draw';
import { publicUrl } from './env';
import { createOffListGift, getMyGift, setGiftApproval, type Gift } from './gifts';
import { postNotice } from './notices';
import { ntfyConfigured, sendNtfy, type NtfyMessage } from './ntfy';
import { approversFor, firstNameOf, getPerson, guardiansOf, householdNamesFor, type Person } from './people';
import { parsePublicUrl, safeFetch } from './safefetch';
import { participantIds } from './season';
import { getNumberSetting, getSetting } from './settings';

/**
 * The anonymous relay. A thread links a question to the person who answers it. The buyer is stored
 * sealed, so the answering side only ever receives the message text and an opaque thread id.
 */

export type ThreadKind = 'question' | 'approval';
export type ThreadRoute = 'person' | 'helpers';
export type ThreadStatus = 'open' | 'answered' | 'approved' | 'declined' | 'closed';

interface ThreadRow {
	id: string;
	season_id: number;
	kind: ThreadKind;
	route: ThreadRoute;
	subject_id: number;
	buyer_tag: string;
	buyer_sealed: string;
	gift_id: string | null;
	status: ThreadStatus;
	created_at: string;
	updated_at: string;
}

interface MessageRow {
	id: string;
	thread_id: string;
	direction: 'to_answerer' | 'to_buyer';
	body: string;
	decision: string | null;
	deliver_at: string;
	delivered_at: string | null;
	read_at: string | null;
	created_at: string;
}

export interface ThreadMessageView {
	id: string;
	mine: boolean;
	body: string;
	decision: string | null;
	pending: boolean;
	at: string;
}

export interface ThreadView {
	id: string;
	kind: ThreadKind;
	route: ThreadRoute;
	status: ThreadStatus;
	subjectName: string;
	title: string;
	role: 'buyer' | 'answerer';
	messages: ThreadMessageView[];
	unread: number;
	gift: { title: string; url: string | null; price_text: string | null; approval: string } | null;
}

export class RelayError extends Error {}

function randomDelayMs(): number {
	const min = Math.max(0, getNumberSetting('relay_delay_min'));
	const max = Math.max(min, getNumberSetting('relay_delay_max'));
	const minutes = min === max ? min : randomInt(Math.round(min * 60), Math.round(max * 60) + 1) / 60;
	return Math.round(minutes * 60_000);
}

function randomDeliveryTime(): string {
	return new Date(Date.now() + randomDelayMs()).toISOString();
}

const SHORT_LINK_HOSTS = new Set(['a.co', 'amzn.to', 'amzn.com', 'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly']);

function isShortLink(url: URL): boolean {
	return SHORT_LINK_HOSTS.has(url.hostname.toLowerCase());
}

/**
 * Removes tracking from a relayed link. Store share links can carry account identifiers, which
 * would tell the person answering who is asking. A short link can't be inspected, and a wish list
 * link points at somebody's account, so both are dropped rather than passed along.
 */
export function cleanRelayUrl(raw: string | null | undefined): string | null {
	if (!raw?.trim()) return null;
	const url = parsePublicUrl(raw);
	if (!url || isShortLink(url)) return null;
	if (/(^|\.)amazon\.[a-z.]{2,8}$/i.test(url.hostname)) {
		if (/\/(hz\/wishlist|gp\/registry)/i.test(url.pathname)) return null;
		const product = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
		if (product) return `https://${url.hostname}/dp/${product[1]}`;
	}
	const keep = ['id', 'pid', 'sku', 'product', 'productid', 'item', 'itemid', 'v', 'variant', 'p'];
	const kept = new URLSearchParams();
	for (const [key, value] of url.searchParams) {
		if (keep.includes(key.toLowerCase())) kept.set(key, value);
	}
	url.search = kept.toString();
	url.hash = '';
	url.pathname = url.pathname.replace(/\/ref=[^/]*/gi, '');
	return url.toString();
}

/** Follows a short link to the real page, so it can be cleaned. Gives up rather than risk a leak. */
export async function resolveRelayUrl(raw: string | null | undefined): Promise<string | null> {
	if (!raw?.trim()) return null;
	const url = parsePublicUrl(raw);
	if (!url) return null;
	if (!isShortLink(url)) return cleanRelayUrl(raw);
	try {
		return cleanRelayUrl((await safeFetch(url.toString())).url);
	} catch {
		return null;
	}
}

function getThread(threadId: string): ThreadRow | null {
	return (db().prepare('SELECT * FROM threads WHERE id = ?').get(threadId) as ThreadRow | undefined) ?? null;
}

function createThread(input: {
	seasonId: number;
	kind: ThreadKind;
	route: ThreadRoute;
	subjectId: number;
	buyerId: number;
	giftId?: string | null;
}): string {
	const id = randomId(20);
	db()
		.prepare(
			`INSERT INTO threads (id, season_id, kind, route, subject_id, buyer_tag, buyer_sealed, gift_id)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			id,
			input.seasonId,
			input.kind,
			input.route,
			input.subjectId,
			giverTag(input.seasonId, input.buyerId),
			seal(input.buyerId),
			input.giftId ?? null
		);
	return id;
}

function addMessage(threadId: string, direction: MessageRow['direction'], body: string, deliverAt: string, decision?: string): string {
	const id = randomId(20);
	db()
		.prepare(
			'INSERT INTO thread_messages (id, thread_id, direction, body, decision, deliver_at) VALUES (?, ?, ?, ?, ?, ?)'
		)
		.run(id, threadId, direction, body.trim().slice(0, 2000), decision ?? null, deliverAt);
	return id;
}

/* ---- Who answers ---- */

/**
 * The adults who can approve a gift for someone, minus anyone connected to the buyer.
 * If the buyer or the parent helping them would be the one asked, there is no one to hide from.
 */
export function effectiveApprovers(subjectId: number, buyerId: number): Person[] {
	const excluded = new Set([buyerId, ...guardiansOf(buyerId).map((g) => g.id)]);
	return approversFor(subjectId).filter((person) => !excluded.has(person.id));
}

function hasOwnApproverPath(subjectId: number, buyerId: number): boolean {
	const excluded = new Set([buyerId, ...guardiansOf(buyerId).map((g) => g.id)]);
	return approversFor(subjectId).some((person) => excluded.has(person.id));
}

/** Everyone who should be notified about a message on this thread. Kids are reached through their own profile. */
function answererIds(thread: ThreadRow): number[] {
	if (thread.route === 'person') return [thread.subject_id];
	const buyerId = unseal<number>(thread.buyer_sealed);
	return effectiveApprovers(thread.subject_id, buyerId).map((person) => person.id);
}

function isAnswerer(thread: ThreadRow, profileId: number): boolean {
	return answererIds(thread).includes(profileId);
}

function isBuyer(thread: ThreadRow, profileId: number): boolean {
	return thread.buyer_tag === giverTag(thread.season_id, profileId);
}

/* ---- Sending ---- */

function requireRecipient(seasonId: number, buyerId: number): Person {
	const recipient = myRecipient(seasonId, buyerId);
	if (!recipient) throw new RelayError('Open your name first, so Santa knows who you are asking about.');
	return recipient;
}

export function askQuestion(seasonId: number, buyerId: number, body: string, route: ThreadRoute): string {
	const recipient = requireRecipient(seasonId, buyerId);
	const text = body.trim();
	if (!text) throw new RelayError('The question is empty.');
	if (route === 'helpers' && !effectiveApprovers(recipient.id, buyerId).length) {
		throw new RelayError(`Nobody is set up to help with questions about ${firstNameOf(recipient.display_name)}.`);
	}
	return tx(() => {
		const threadId = createThread({ seasonId, kind: 'question', route, subjectId: recipient.id, buyerId });
		addMessage(threadId, 'to_answerer', text, randomDeliveryTime());
		return threadId;
	});
}

export type ApprovalOutcome =
	| { outcome: 'sent'; threadId: string; gift: Gift }
	| { outcome: 'auto_approved'; gift: Gift; reason: 'no_approver' | 'you_decide' };

/** Sends a permission slip for an off-list gift, creating the gift record if needed. */
export function requestApproval(
	seasonId: number,
	buyerId: number,
	input: { title: string; url?: string | null; price_text?: string | null; message: string; giftId?: string }
): ApprovalOutcome {
	const recipient = requireRecipient(seasonId, buyerId);
	const title = input.title.trim();
	if (!title) throw new RelayError('Tell Santa what the gift is.');
	const url = cleanRelayUrl(input.url);
	const approvers = effectiveApprovers(recipient.id, buyerId);

	return tx(() => {
		const existing = input.giftId ? getMyGift(seasonId, buyerId, input.giftId) : null;
		const gift =
			existing ?? createOffListGift(seasonId, buyerId, { title, url, price_text: input.price_text, approval: 'none' });
		if (!gift) throw new RelayError('Santa could not record that gift.');

		if (!approvers.length) {
			setGiftApproval(gift.id, 'approved');
			return {
				outcome: 'auto_approved' as const,
				gift: { ...gift, approval: 'approved' as const },
				reason: hasOwnApproverPath(recipient.id, buyerId) ? ('you_decide' as const) : ('no_approver' as const)
			};
		}
		setGiftApproval(gift.id, 'waiting');
		const threadId = createThread({
			seasonId,
			kind: 'approval',
			route: 'helpers',
			subjectId: recipient.id,
			buyerId,
			giftId: gift.id
		});
		addMessage(threadId, 'to_answerer', input.message, randomDeliveryTime());
		return { outcome: 'sent' as const, threadId, gift: { ...gift, approval: 'waiting' as const } };
	});
}

/** Sends every message that has reached its delivery time, and tells the person it arrived. */
export function deliverDueMessages(): number {
	const due = db()
		.prepare(
			`SELECT m.* FROM thread_messages m
			 JOIN threads t ON t.id = m.thread_id
			 JOIN seasons s ON s.id = t.season_id
			 WHERE m.delivered_at IS NULL AND m.deliver_at <= ? AND t.status != 'closed' AND s.status != 'archived'`
		)
		.all(nowIso()) as MessageRow[];
	for (const message of due) {
		const thread = getThread(message.thread_id);
		if (!thread) continue;
		tx(() => {
			db().prepare('UPDATE thread_messages SET delivered_at = ? WHERE id = ?').run(nowIso(), message.id);
			// The thread only moves now, so its position and status can't reveal when it was really sent.
			db()
				.prepare(`UPDATE threads SET updated_at = ?, status = CASE WHEN status = 'answered' THEN 'open' ELSE status END WHERE id = ?`)
				.run(nowIso(), thread.id);
			const subject = getPerson(thread.subject_id);
			const name = firstNameOf(subject?.display_name ?? 'someone');
			const isSlip = thread.kind === 'approval';
			const directToKid = thread.route === 'person' && subject?.kind === 'kid';
			for (const personId of answererIds(thread)) {
				postNotice({
					seasonId: thread.season_id,
					personId,
					kind: 'mail',
					title: isSlip
						? `Santa has a permission slip about ${name}`
						: thread.route === 'helpers'
							? `One of Santa's elves has a question about ${name}`
							: directToKid
								? `One of Santa's elves has a question for ${name}`
								: "One of Santa's elves has a question for you",
					body: 'Open North Pole Mail to read it. Whoever asked stays secret.',
					link: '/mail'
				});
			}
		});
	}
	return due.length;
}

/* ---- Telling the organizer which family has mail ---- */

const NO_HOUSEHOLD = 'someone with no household';
const MAIL_PING_RETRY_MS = 5 * 60_000;
let mailPingRetryAt = 0;

/**
 * The families to name for a message on this thread. Everything here has to be the same no matter
 * who asked. That's why this lists everyone who could answer, rather than who received it: the
 * buyer and their parents are left out of the mailing, so naming only the rest could point at them.
 */
function familiesReached(thread: Pick<ThreadRow, 'route' | 'subject_id'>): string[] {
	const subject = getPerson(thread.subject_id);
	const people = thread.route === 'person' ? (subject ? [subject] : []) : approversFor(thread.subject_id);
	const names = people.flatMap(householdNamesFor);
	return names.length ? names : [NO_HOUSEHOLD];
}

function listOfNames(names: string[]): string {
	return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** The whole ping. It takes only family names, so it can't include who asked, who it's for, or what it says. */
export function buildMailPing(families: string[]): NtfyMessage {
	const lines =
		families.length > 1
			? ['Each of these has a new message waiting. Let them know to sign in and check their mail.']
			: families[0] === NO_HOUSEHOLD
				? ['They have a new message waiting. Let them know to sign in and check their mail.']
				: ['Someone there has a new message waiting. Let them know to sign in and check their mail.'];
	if (families.includes(NO_HOUSEHOLD)) lines.push('Put everyone in a household on the People page, so these pings can name the family.');
	return {
		title: `North Pole Mail: ${listOfNames(families)}`,
		message: lines.join(' '),
		click: `${publicUrl()}/admin/people`,
		tags: ['envelope'],
		actions: [
			{
				label: 'Text someone',
				// This links to the home page, not the mailbox. A message may be under a kid's profile,
				// which the home page points out and a parent's own mailbox doesn't show.
				url: smsLink('', `Ho ho ho! Santa has left a message for your family. Sign in to have a look: ${publicUrl()}`)
			}
		]
	};
}

/**
 * Pings the organizer when a message reaches the person being asked, naming only the family.
 *
 * Only messages to the person being asked count. Pinging for a reply would name the asker's family,
 * and the organizer could be the one who just replied, so they'd learn where their own Santa is.
 * Running this after delivery also means the ping carries the same random delay as the message.
 */
export async function pingFamiliesAboutNewMail(): Promise<void> {
	const pending = db()
		.prepare(
			`SELECT m.id AS message_id, t.route, t.subject_id FROM thread_messages m
			 JOIN threads t ON t.id = m.thread_id
			 WHERE m.direction = 'to_answerer' AND m.delivered_at IS NOT NULL AND m.family_ping_done = 0`
		)
		.all() as { message_id: string; route: ThreadRoute; subject_id: number }[];
	if (!pending.length) return;

	const markDone = () => {
		const update = db().prepare('UPDATE thread_messages SET family_ping_done = 1 WHERE id = ?');
		tx(() => {
			for (const row of pending) update.run(row.message_id);
		});
	};

	// With pings off there's no backlog to send later, so turning them on doesn't announce old mail.
	if (getSetting('ntfy_mail_alerts') !== '1' || !ntfyConfigured()) return markDone();
	if (Date.now() < mailPingRetryAt) return;

	const families = [...new Set(pending.flatMap(familiesReached))];
	const result = await sendNtfy(buildMailPing(families));
	if (!result.ok) {
		// A person is relying on this ping to pass the message along, so it stays queued until it works.
		mailPingRetryAt = Date.now() + MAIL_PING_RETRY_MS;
		console.warn(`[santa] Could not send a mail ping, and will try again soon: ${result.reason}`);
		return;
	}
	mailPingRetryAt = 0;
	markDone();
}

function notifyBuyer(thread: ThreadRow, title: string, body: string): void {
	postNotice({
		seasonId: thread.season_id,
		personId: unseal<number>(thread.buyer_sealed),
		kind: 'mail',
		title,
		body,
		link: '/mail'
	});
}

/* ---- Answering ---- */

/** The person being asked replies. Their name is no secret, so this arrives immediately. */
export function replyToBuyer(threadId: string, answererId: number, body: string): void {
	const thread = getThread(threadId);
	if (!thread || !isAnswerer(thread, answererId)) throw new RelayError('Santa could not find that message.');
	if (thread.status === 'closed') throw new RelayError('This conversation has closed.');
	if (thread.kind !== 'question') throw new RelayError('Use the approve and decline buttons for permission slips.');
	const text = body.trim();
	if (!text) throw new RelayError('The reply is empty.');
	const subject = getPerson(thread.subject_id);
	tx(() => {
		const now = nowIso();
		const id = addMessage(threadId, 'to_buyer', text, now);
		db().prepare('UPDATE thread_messages SET delivered_at = ? WHERE id = ?').run(now, id);
		db().prepare(`UPDATE threads SET status = 'answered', updated_at = ? WHERE id = ?`).run(now, threadId);
		notifyBuyer(thread, `Santa has an answer about ${firstNameOf(subject?.display_name ?? 'your person')}`, 'Open North Pole Mail to read it.');
	});
}

/** The buyer adds to their own thread. This stays anonymous, so it gets the same delivery delay. */
export function followUpFromBuyer(threadId: string, buyerId: number, body: string): void {
	const thread = getThread(threadId);
	if (!thread || !isBuyer(thread, buyerId)) throw new RelayError('Santa could not find that message.');
	if (thread.status === 'closed') throw new RelayError('This conversation has closed.');
	if (thread.kind !== 'question') throw new RelayError('Send a new permission slip instead.');
	const text = body.trim();
	if (!text) throw new RelayError('The message is empty.');
	addMessage(threadId, 'to_answerer', text, randomDeliveryTime());
}

/** The first approver to answer decides. */
export function decideApproval(threadId: string, approverId: number, approved: boolean, note: string): void {
	const thread = getThread(threadId);
	if (!thread || thread.kind !== 'approval' || !isAnswerer(thread, approverId)) {
		throw new RelayError('Santa could not find that permission slip.');
	}
	if (thread.status !== 'open') throw new RelayError('Someone has already answered this permission slip.');
	const subject = getPerson(thread.subject_id);
	const name = firstNameOf(subject?.display_name ?? 'your person');
	const decision = approved ? 'approved' : 'declined';
	tx(() => {
		const now = nowIso();
		const id = addMessage(threadId, 'to_buyer', note.trim() || (approved ? 'Yes, that is fine!' : 'Please pick something else.'), now, decision);
		db().prepare('UPDATE thread_messages SET delivered_at = ? WHERE id = ?').run(now, id);
		db().prepare('UPDATE threads SET status = ?, updated_at = ? WHERE id = ?').run(decision, now, threadId);
		if (thread.gift_id) setGiftApproval(thread.gift_id, decision);
		notifyBuyer(
			thread,
			approved ? `Permission granted for ${name}'s gift!` : `Santa says pick something else for ${name}`,
			'Open North Pole Mail to read the note.'
		);
	});
}

/* ---- Reading ---- */

function giftFor(thread: ThreadRow): ThreadView['gift'] {
	if (!thread.gift_id) return null;
	const row = db().prepare('SELECT title, url, price_text, approval FROM gifts WHERE id = ?').get(thread.gift_id) as
		| { title: string; url: string | null; price_text: string | null; approval: string }
		| undefined;
	return row ?? null;
}

function threadTitle(thread: ThreadRow, role: ThreadView['role'], subject: string): string {
	if (role === 'buyer') return `${thread.kind === 'approval' ? 'Permission slip' : 'Your question'} about ${subject}`;
	if (thread.kind === 'approval') return `Permission slip about ${subject}`;
	return thread.route === 'helpers' ? `Question about ${subject}` : "Question from one of Santa's elves";
}

function toView(thread: ThreadRow, role: ThreadView['role']): ThreadView {
	const rows = db()
		.prepare('SELECT * FROM thread_messages WHERE thread_id = ? ORDER BY COALESCE(delivered_at, created_at), rowid')
		.all(thread.id) as MessageRow[];
	const visible = rows.filter((row) => role === 'buyer' || row.direction === 'to_buyer' || row.delivered_at);
	const incoming = role === 'buyer' ? 'to_buyer' : 'to_answerer';
	const subject = getPerson(thread.subject_id);
	return {
		id: thread.id,
		kind: thread.kind,
		route: thread.route,
		status: thread.status,
		subjectName: subject?.display_name ?? 'Someone',
		title: threadTitle(thread, role, subject?.display_name ?? 'someone'),
		role,
		unread: visible.filter((row) => row.direction === incoming && row.delivered_at && !row.read_at).length,
		gift: giftFor(thread),
		messages: visible.map((row) => ({
			id: row.id,
			mine: row.direction !== incoming,
			body: row.body,
			decision: row.decision,
			pending: !row.delivered_at,
			// The answering side sees delivery time, so the real sending time stays hidden.
			at: role === 'buyer' ? row.created_at : (row.delivered_at ?? row.created_at)
		}))
	};
}

export function threadsAsBuyer(seasonId: number, profileId: number): ThreadView[] {
	const rows = db()
		.prepare('SELECT * FROM threads WHERE season_id = ? AND buyer_tag = ? ORDER BY updated_at DESC')
		.all(seasonId, giverTag(seasonId, profileId)) as ThreadRow[];
	return rows.map((row) => toView(row, 'buyer'));
}

export function threadsAsAnswerer(seasonId: number, profileId: number): ThreadView[] {
	const rows = db()
		.prepare(`SELECT * FROM threads WHERE season_id = ? AND status != 'closed' ORDER BY updated_at DESC`)
		.all(seasonId) as ThreadRow[];
	return rows
		.filter((row) => isAnswerer(row, profileId))
		.map((row) => toView(row, 'answerer'))
		.filter((view) => view.messages.length > 0);
}

export function markThreadRead(threadId: string, profileId: number): void {
	const thread = getThread(threadId);
	if (!thread) return;
	const direction = isBuyer(thread, profileId) ? 'to_buyer' : isAnswerer(thread, profileId) ? 'to_answerer' : null;
	if (!direction) return;
	db()
		.prepare(
			'UPDATE thread_messages SET read_at = ? WHERE thread_id = ? AND direction = ? AND delivered_at IS NOT NULL AND read_at IS NULL'
		)
		.run(nowIso(), threadId, direction);
}

export interface WaitingMail {
	id: string;
	kind: ThreadKind;
	title: string;
	excerpt: string;
}

/** Mail that still needs this person's answer. Reading it doesn't clear it. Only answering does. */
export function waitingOnMe(seasonId: number, profileId: number): WaitingMail[] {
	return threadsAsAnswerer(seasonId, profileId)
		.filter((thread) => thread.status === 'open')
		.map((thread) => ({
			id: thread.id,
			kind: thread.kind,
			title: thread.title,
			excerpt: thread.messages.filter((message) => !message.mine).at(-1)?.body ?? ''
		}));
}

/** What the mail badge counts: conversations needing an answer, plus new answers to read. */
export function mailBadgeCount(seasonId: number, profileId: number): number {
	const newAnswers = threadsAsBuyer(seasonId, profileId).filter((thread) => thread.unread > 0).length;
	return waitingOnMe(seasonId, profileId).length + newAnswers;
}

/** People with nobody to approve gifts for them, so the admin can fix it before it matters. */
export function peopleWithoutApprovers(seasonId: number): Person[] {
	return participantIds(seasonId)
		.filter((id) => !approversFor(id).length)
		.map((id) => getPerson(id))
		.filter((person): person is Person => !!person);
}
