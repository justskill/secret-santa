import { z } from 'zod';
import { formatDate, formatDateTime } from '$lib/time';
import { listCountdowns, listIsLocked } from '../countdowns';
import { drawIsOpen, hasAssignment, hasRevealed, myRecipient } from '../draw';
import { myGifts } from '../gifts';
import { firstNameOf, type Person } from '../people';
import type { Season } from '../season';
import { getSetting } from '../settings';
import { effectiveApprovers, resolveRelayUrl, threadsAsAnswerer, threadsAsBuyer } from '../threads';
import { getGuidance, getItem, getListMeta, listItems } from '../wishlist';
import { createAction, type ActionCard } from './actions';
import { rewriteForRelay } from './writing';

/**
 * Santa's tools, and the reason he cannot leak who drew whom.
 *
 * No tool takes a person as a parameter. Each one acts on the signed-in profile, which comes from
 * the session on the server. There is no tool that answers "who drew this person", so no prompt,
 * however clever, can get an answer out of Santa: the information never reaches him.
 */

export interface ToolContext {
	season: Season;
	profile: Person;
	actor: Person;
	onCard: (card: ActionCard) => void;
}

interface SantaTool<Schema extends z.ZodType = z.ZodType> {
	name: string;
	description: string;
	status: string;
	schema: Schema;
	run: (ctx: ToolContext, input: z.infer<Schema>) => Promise<unknown> | unknown;
}

function tool<Schema extends z.ZodType>(definition: SantaTool<Schema>): SantaTool {
	return definition as unknown as SantaTool;
}

function reference(profileName: string, ctx: ToolContext): string {
	return ctx.profile.kind === 'kid' ? `${firstNameOf(profileName)}'s` : 'your';
}

function myListSummary(ctx: ToolContext) {
	const meta = getListMeta(ctx.season.id, ctx.profile.id);
	return {
		ready: !!meta.ready_at,
		locked: listIsLocked(ctx.season.id),
		amazon_list_link: meta.amazon_url,
		items: listItems(ctx.season.id, ctx.profile.id).map((item) => ({
			id: item.id,
			title: item.title,
			link: item.url,
			price: item.price_text,
			notes: item.notes,
			priority: item.priority === 1 ? 'really wants' : item.priority === 3 ? 'nice to have' : 'would like'
		}))
	};
}

function requireMyPerson(ctx: ToolContext): Person | { error: string } {
	const recipient = myRecipient(ctx.season.id, ctx.profile.id);
	return recipient ?? { error: 'Their draw is not revealed yet. They need to open their name on the Draw page first.' };
}

function isError(value: unknown): value is { error: string } {
	return typeof value === 'object' && value !== null && 'error' in value;
}

function cardResult(card: ActionCard) {
	return {
		card_shown: true,
		wording_on_card: card.body || undefined,
		next_step: 'A confirmation card is on screen. Nothing has happened yet: it runs only if they tap the button.'
	};
}

const blankToNull = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);

export const SANTA_TOOLS: SantaTool[] = [
	tool({
		name: 'get_season_overview',
		description:
			"Get this family's Secret Santa rules, spending limit, countdowns and dates, and where this person stands: whether the draw is open and whether they have opened their name. Use for any question about how things work or when things happen.",
		status: 'Checking the workshop calendar...',
		schema: z.object({}),
		run: (ctx) => {
			const timeZone = getSetting('timezone');
			const { season, profile } = ctx;
			return {
				season: season.name,
				stage: season.status,
				spending_limit: season.spend_limit || 'none set',
				house_rules: season.house_rules,
				countdowns: listCountdowns(season.id)
					.filter((c) => c.visible)
					.map((c) => ({
						title: c.title,
						when: formatDateTime(c.target_at, timeZone),
						date: formatDate(c.target_at, timeZone),
						type: c.kind,
						has_passed: c.target_at <= new Date().toISOString(),
						locks_lists_when_passed: c.kind === 'list_deadline' ? !!c.hard_lock : undefined
					})),
				this_person: {
					is_in_the_draw: hasAssignment(season.id, profile.id) || season.status === 'setup',
					names_sealed: season.status !== 'setup',
					draw_open: drawIsOpen(season),
					draw_opens_at: season.draw_opens_at ? formatDateTime(season.draw_opens_at, timeZone) : null,
					has_opened_their_gift: hasRevealed(season.id, profile.id)
				}
			};
		}
	}),

	tool({
		name: 'get_my_list',
		description: "Get this person's own wish list, whether it is marked ready, and their Amazon list link if they added one.",
		status: 'Unrolling the wish list...',
		schema: z.object({}),
		run: (ctx) => myListSummary(ctx)
	}),

	tool({
		name: 'get_my_person',
		description:
			'Get the person this profile drew: their name, wish list, shopping notes, and the gifts already tracked for them. If the person has not opened their name yet, this reports that and shows no name.',
		status: "Checking your person's stocking...",
		schema: z.object({}),
		run: (ctx) => {
			const recipient = requireMyPerson(ctx);
			if (isError(recipient)) return recipient;
			const guidance = getGuidance(recipient.id);
			const meta = getListMeta(ctx.season.id, recipient.id);
			const gifts = myGifts(ctx.season.id, ctx.profile.id);
			return {
				name: recipient.display_name,
				is_kid: recipient.kind === 'kid',
				list_marked_ready: !!meta.ready_at,
				amazon_list_link: meta.amazon_url,
				list_note: meta.intro_note,
				items: listItems(ctx.season.id, recipient.id).map((item) => ({
					id: item.id,
					title: item.title,
					link: item.url,
					price: item.price_text,
					notes: item.notes,
					priority: item.priority === 1 ? 'really wants' : item.priority === 3 ? 'nice to have' : 'would like',
					you_bought_it: gifts.some((gift) => gift.wish_item_id === item.id && gift.bought)
				})),
				shopping_notes: guidance.notes,
				notes_from_their_family: guidance.helper_notes,
				gifts_tracked: gifts.map((gift) => ({
					id: gift.id,
					title: gift.title,
					off_list: !!gift.off_list,
					bought: !!gift.bought,
					approval: gift.approval
				})),
				can_ask_a_helper_about_them: effectiveApprovers(recipient.id, ctx.profile.id).length > 0
			};
		}
	}),

	tool({
		name: 'get_my_mail',
		description:
			'Get this person\'s North Pole Mail: questions they asked as a Santa and any answers, questions sent to them by their own anonymous Santa, and permission slips waiting on their decision. Each has a thread_id for replying.',
		status: 'Sorting the mail sack...',
		schema: z.object({}),
		run: (ctx) => ({
			questions_i_asked: threadsAsBuyer(ctx.season.id, ctx.profile.id).map((thread) => ({
				thread_id: thread.id,
				type: thread.kind === 'approval' ? 'permission slip' : 'question',
				about: thread.subjectName,
				status: thread.status,
				messages: thread.messages.map((m) => ({
					from: m.mine ? 'me' : 'the person answering',
					text: m.body,
					decision: m.decision ?? undefined,
					still_on_its_way: m.pending || undefined
				}))
			})),
			messages_to_me: threadsAsAnswerer(ctx.season.id, ctx.profile.id).map((thread) => ({
				thread_id: thread.id,
				type: thread.kind === 'approval' ? 'permission slip needing a decision' : 'question from an anonymous elf',
				about: thread.subjectName,
				status: thread.status,
				gift: thread.gift ? { title: thread.gift.title, link: thread.gift.url, price: thread.gift.price_text } : undefined,
				messages: thread.messages.map((m) => ({
					from: m.mine ? 'me' : 'anonymous elf',
					text: m.body
				}))
			}))
		})
	}),

	tool({
		name: 'propose_add_wishes',
		description: "Propose adding items to this person's own wish list. Shows a card; nothing is added until they tap it.",
		status: 'Sharpening a quill...',
		schema: z.object({
			items: z
				.array(
					z.object({
						title: z.string().min(1).describe('Short name of the item'),
						url: z.string().nullable().optional().describe('A link you actually found, or that they gave you'),
						price: z.string().nullable().optional(),
						notes: z.string().nullable().optional().describe('Size, colour, or other details'),
						priority: z.enum(['really wants', 'would like', 'nice to have']).optional()
					})
				)
				.min(1)
				.max(15)
		}),
		run: (ctx, input: { items: { title: string; url?: string | null; price?: string | null; notes?: string | null; priority?: string }[] }) => {
			if (listIsLocked(ctx.season.id)) return { error: 'The list deadline has passed and lists are locked.' };
			const items = input.items.map((item) => ({
				title: item.title,
				url: blankToNull(item.url),
				price_text: blankToNull(item.price),
				notes: blankToNull(item.notes),
				priority: item.priority === 'really wants' ? 1 : item.priority === 'nice to have' ? 3 : 2
			}));
			const card = createAction(ctx.season.id, ctx.profile.id, { kind: 'add_items', items }, {
				title: `Add to ${reference(ctx.profile.display_name, ctx)} wish list`,
				body: '',
				bullets: items.map((item) => (item.price_text ? `${item.title} (${item.price_text})` : item.title)),
				notes: [],
				confirmLabel: 'Add to list',
				cancelLabel: 'Not now',
				editable: false
			});
			ctx.onCard(card);
			return cardResult(card);
		}
	}),

	tool({
		name: 'propose_change_wish',
		description: "Propose editing or removing one item on this person's own wish list. Item IDs come from get_my_list.",
		status: 'Sharpening a quill...',
		schema: z.object({
			item_id: z.number().int(),
			action: z.enum(['remove', 'edit']),
			title: z.string().nullable().optional(),
			url: z.string().nullable().optional(),
			price: z.string().nullable().optional(),
			notes: z.string().nullable().optional(),
			priority: z.enum(['really wants', 'would like', 'nice to have']).nullable().optional()
		}),
		run: (
			ctx,
			input: { item_id: number; action: 'remove' | 'edit'; title?: string | null; url?: string | null; price?: string | null; notes?: string | null; priority?: string | null }
		) => {
			const item = getItem(input.item_id);
			if (!item || item.person_id !== ctx.profile.id || item.season_id !== ctx.season.id) {
				return { error: 'That item is not on this person\'s list.' };
			}
			if (listIsLocked(ctx.season.id)) return { error: 'The list deadline has passed and lists are locked.' };
			if (input.action === 'remove') {
				const card = createAction(ctx.season.id, ctx.profile.id, { kind: 'remove_item', itemId: item.id, title: item.title }, {
					title: 'Remove this wish?',
					body: '',
					bullets: [item.title],
					notes: [],
					confirmLabel: 'Remove it',
					cancelLabel: 'Keep it',
					editable: false
				});
				ctx.onCard(card);
				return cardResult(card);
			}
			const changes = {
				...(input.title ? { title: input.title } : {}),
				...(input.url !== undefined ? { url: input.url } : {}),
				...(input.price !== undefined ? { price_text: input.price } : {}),
				...(input.notes !== undefined ? { notes: input.notes ?? '' } : {}),
				...(input.priority ? { priority: input.priority === 'really wants' ? 1 : input.priority === 'nice to have' ? 3 : 2 } : {})
			};
			const card = createAction(ctx.season.id, ctx.profile.id, { kind: 'update_item', itemId: item.id, title: item.title, changes }, {
				title: `Update "${item.title}"`,
				body: '',
				bullets: [
					input.title ? `New name: ${input.title}` : '',
					input.price ? `Price: ${input.price}` : '',
					input.notes ? `Notes: ${input.notes}` : '',
					input.url ? `Link: ${input.url}` : '',
					input.priority ? `Priority: ${input.priority}` : ''
				].filter(Boolean),
				notes: [],
				confirmLabel: 'Save changes',
				cancelLabel: 'Not now',
				editable: false
			});
			ctx.onCard(card);
			return cardResult(card);
		}
	}),

	tool({
		name: 'propose_list_ready',
		description: "Propose marking this person's own wish list as ready (or reopening it). Their Santa is told when it is ready.",
		status: 'Sharpening a quill...',
		schema: z.object({ ready: z.boolean() }),
		run: (ctx, input: { ready: boolean }) => {
			if (listIsLocked(ctx.season.id)) return { error: 'The list deadline has passed and lists are locked.' };
			const card = createAction(ctx.season.id, ctx.profile.id, { kind: 'list_ready', ready: input.ready }, {
				title: input.ready ? 'Mark this list as ready?' : 'Reopen this list?',
				body: input.ready ? 'Santa will tell whoever drew this name that the list is ready.' : '',
				bullets: [],
				notes: [],
				confirmLabel: input.ready ? 'Mark as ready' : 'Reopen',
				cancelLabel: 'Not yet',
				editable: false
			});
			ctx.onCard(card);
			return cardResult(card);
		}
	}),

	tool({
		name: 'propose_anonymous_question',
		description:
			"Prepare an anonymous question about the person this profile drew. Choose send_to 'person' to ask them directly, or 'helper' to ask their parent or spouse instead so the surprise stays safe. The text is automatically reworded to hide who wrote it, and the card shows the reworded version.",
		status: 'Santa is rewording this so nobody can tell who asked...',
		schema: z.object({
			question: z.string().min(1).describe('What they want to know, in their own words'),
			send_to: z.enum(['person', 'helper'])
		}),
		run: async (ctx, input: { question: string; send_to: 'person' | 'helper' }) => {
			const recipient = requireMyPerson(ctx);
			if (isError(recipient)) return recipient;
			const name = firstNameOf(recipient.display_name);
			if (input.send_to === 'helper' && !effectiveApprovers(recipient.id, ctx.profile.id).length) {
				return { error: `Nobody is set up as a helper for ${name}. Offer to ask ${name} directly instead.` };
			}
			const rewrite = await rewriteForRelay({
				text: input.question,
				purpose: input.send_to === 'person' ? 'question_to_person' : 'question_to_helper',
				senderName: ctx.profile.display_name,
				subjectName: recipient.display_name
			});
			const card = createAction(
				ctx.season.id,
				ctx.profile.id,
				{ kind: 'send_question', route: input.send_to === 'person' ? 'person' : 'helpers', subjectId: recipient.id, text: rewrite.text },
				{
					title: input.send_to === 'person' ? `Anonymous question for ${name}` : `Anonymous question for ${name}'s parent or spouse`,
					body: rewrite.text,
					bullets: [],
					notes: rewrite.notes,
					confirmLabel: 'Send anonymously',
					cancelLabel: "Don't send",
					editable: true
				}
			);
			ctx.onCard(card);
			return cardResult(card);
		}
	}),

	tool({
		name: 'propose_permission_slip',
		description:
			"Prepare a permission slip: an anonymous request to the parent or spouse of the person this profile drew, asking whether an off-list gift is OK. Use this for any gift not on that person's wish list.",
		status: 'Santa is filling in a permission slip...',
		schema: z.object({
			gift: z.string().min(1).describe('What the gift is'),
			price: z.string().nullable().optional(),
			link: z.string().nullable().optional().describe('A product link, if they have one'),
			why: z.string().nullable().optional().describe('Why they think it would be a good gift')
		}),
		run: async (ctx, input: { gift: string; price?: string | null; link?: string | null; why?: string | null }) => {
			const recipient = requireMyPerson(ctx);
			if (isError(recipient)) return recipient;
			const name = firstNameOf(recipient.display_name);
			const rewrite = await rewriteForRelay({
				text: `Is it OK to give ${name} this gift, which is not on the wish list: ${input.gift}${input.price ? ` (about ${input.price})` : ''}.${input.why ? ` Reason: ${input.why}` : ''}`,
				purpose: 'permission_slip',
				senderName: ctx.profile.display_name,
				subjectName: recipient.display_name
			});
			const link = await resolveRelayUrl(input.link);
			const card = createAction(
				ctx.season.id,
				ctx.profile.id,
				{
					kind: 'permission_slip',
					subjectId: recipient.id,
					gift: input.gift,
					price: blankToNull(input.price),
					url: link,
					text: rewrite.text
				},
				{
					title: `Permission slip for ${name}'s gift`,
					body: rewrite.text,
					bullets: [
						`Gift: ${input.gift}`,
						...(input.price ? [`Price: ${input.price}`] : []),
						...(link ? [`Link: ${link}`] : [])
					],
					notes: rewrite.notes,
					confirmLabel: 'Send the slip',
					cancelLabel: "Don't send",
					editable: true
				}
			);
			ctx.onCard(card);
			return cardResult(card);
		}
	}),

	tool({
		name: 'propose_follow_up',
		description: 'Prepare an anonymous follow-up on a question this person already asked as a Santa. The thread_id comes from questions_i_asked in get_my_mail.',
		status: 'Santa is rewording this so nobody can tell who asked...',
		schema: z.object({ thread_id: z.string(), message: z.string().min(1) }),
		run: async (ctx, input: { thread_id: string; message: string }) => {
			const thread = threadsAsBuyer(ctx.season.id, ctx.profile.id).find((t) => t.id === input.thread_id);
			if (!thread) return { error: 'That is not one of their questions.' };
			const rewrite = await rewriteForRelay({
				text: input.message,
				purpose: 'follow_up',
				senderName: ctx.profile.display_name,
				subjectName: thread.subjectName
			});
			const card = createAction(ctx.season.id, ctx.profile.id, { kind: 'follow_up', threadId: thread.id, text: rewrite.text }, {
				title: 'Anonymous follow-up',
				body: rewrite.text,
				bullets: [],
				notes: rewrite.notes,
				confirmLabel: 'Send anonymously',
				cancelLabel: "Don't send",
				editable: true
			});
			ctx.onCard(card);
			return cardResult(card);
		}
	}),

	tool({
		name: 'propose_reply',
		description: 'Prepare an answer to a question an anonymous elf sent to this person. The thread_id comes from messages_to_me in get_my_mail.',
		status: 'Sharpening a quill...',
		schema: z.object({ thread_id: z.string(), reply: z.string().min(1) }),
		run: (ctx, input: { thread_id: string; reply: string }) => {
			const thread = threadsAsAnswerer(ctx.season.id, ctx.profile.id).find((t) => t.id === input.thread_id && t.kind === 'question');
			if (!thread) return { error: 'That is not a question waiting on this person.' };
			const card = createAction(ctx.season.id, ctx.profile.id, { kind: 'reply', threadId: thread.id, text: input.reply }, {
				title: 'Your answer',
				body: input.reply,
				bullets: [],
				notes: [],
				confirmLabel: 'Send answer',
				cancelLabel: "Don't send",
				editable: true
			});
			ctx.onCard(card);
			return cardResult(card);
		}
	}),

	tool({
		name: 'propose_slip_decision',
		description: 'Prepare a decision on a permission slip addressed to this person. The thread_id comes from messages_to_me in get_my_mail.',
		status: 'Sharpening a quill...',
		schema: z.object({
			thread_id: z.string(),
			approved: z.boolean(),
			note: z.string().nullable().optional().describe('An optional note back to the shopper')
		}),
		run: (ctx, input: { thread_id: string; approved: boolean; note?: string | null }) => {
			const thread = threadsAsAnswerer(ctx.season.id, ctx.profile.id).find(
				(t) => t.id === input.thread_id && t.kind === 'approval' && t.status === 'open'
			);
			if (!thread) return { error: 'That is not a permission slip waiting on this person.' };
			const card = createAction(
				ctx.season.id,
				ctx.profile.id,
				{ kind: 'decide_slip', threadId: thread.id, approved: input.approved, note: input.note ?? '' },
				{
					title: input.approved ? `Approve this gift for ${firstNameOf(thread.subjectName)}?` : `Decline this gift for ${firstNameOf(thread.subjectName)}?`,
					body: input.note ?? '',
					bullets: thread.gift ? [`Gift: ${thread.gift.title}`] : [],
					notes: [],
					confirmLabel: input.approved ? 'Approve' : 'Decline',
					cancelLabel: 'Not yet',
					editable: false
				}
			);
			ctx.onCard(card);
			return cardResult(card);
		}
	}),

	tool({
		name: 'propose_mark_bought',
		description:
			"Prepare to record a purchase for the person this profile drew. Use item_id for something on their wish list, gift_id for an already-tracked gift, or off_list_title for an off-list gift bought without a permission slip. Item and gift IDs come from get_my_person.",
		status: 'Updating the ledger...',
		schema: z.object({
			item_id: z.number().int().nullable().optional(),
			gift_id: z.string().nullable().optional(),
			off_list_title: z.string().nullable().optional(),
			bought: z.boolean().optional().describe('Set false to undo. Defaults to true.')
		}),
		run: (ctx, input: { item_id?: number | null; gift_id?: string | null; off_list_title?: string | null; bought?: boolean }) => {
			const recipient = requireMyPerson(ctx);
			if (isError(recipient)) return recipient;
			const bought = input.bought !== false;
			if (input.item_id) {
				const item = getItem(input.item_id);
				if (!item || item.person_id !== recipient.id) return { error: "That item is not on their person's list." };
				const card = createAction(ctx.season.id, ctx.profile.id, { kind: 'item_bought', itemId: item.id, title: item.title, bought }, {
					title: bought ? 'Mark as bought?' : 'Mark as not bought?',
					body: '',
					bullets: [item.title],
					notes: [],
					confirmLabel: bought ? 'Mark as bought' : 'Unmark it',
					cancelLabel: 'Not yet',
					editable: false
				});
				ctx.onCard(card);
				return cardResult(card);
			}
			if (input.gift_id) {
				const gift = myGifts(ctx.season.id, ctx.profile.id).find((g) => g.id === input.gift_id);
				if (!gift) return { error: 'That is not one of their tracked gifts.' };
				const card = createAction(ctx.season.id, ctx.profile.id, { kind: 'gift_bought', giftId: gift.id, title: gift.title, bought }, {
					title: bought ? 'Mark as bought?' : 'Mark as not bought?',
					body: '',
					bullets: [gift.title],
					notes: gift.off_list && gift.approval === 'declined' ? ['This gift was declined on its permission slip.'] : [],
					confirmLabel: bought ? 'Mark as bought' : 'Unmark it',
					cancelLabel: 'Not yet',
					editable: false
				});
				ctx.onCard(card);
				return cardResult(card);
			}
			if (input.off_list_title) {
				const card = createAction(
					ctx.season.id,
					ctx.profile.id,
					{ kind: 'log_off_list_bought', title: input.off_list_title, price: null, url: null },
					{
						title: 'Log an off-list gift without a permission slip?',
						body: '',
						bullets: [input.off_list_title],
						notes: ['The family rule is to ask first. Sending a permission slip is still an option.'],
						confirmLabel: 'Log it anyway',
						cancelLabel: 'Cancel',
						editable: false
					}
				);
				ctx.onCard(card);
				return cardResult(card);
			}
			return { error: 'Say which item or gift this is for.' };
		}
	})
];

export function toolByName(name: string): SantaTool | undefined {
	return SANTA_TOOLS.find((candidate) => candidate.name === name);
}

/** The API definitions, in a fixed order so the cached prompt prefix stays byte-identical. */
export function toolDefinitions() {
	return SANTA_TOOLS.map((definition) => ({
		name: definition.name,
		description: definition.description,
		input_schema: z.toJSONSchema(definition.schema, { target: 'draft-7' }) as { type: 'object'; [key: string]: unknown },
		eager_input_streaming: true
	}));
}
