<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import RelayComposer from '$lib/components/RelayComposer.svelte';
	import SantaFace from '$lib/components/SantaFace.svelte';
	import { relativeTime } from '$lib/time';

	let { data, form } = $props();

	let followUps = $state<Record<string, string>>({});

	// Loading this page marks mail as read, so the badge can clear now.
	onMount(() => void invalidate('app:badges'));

	const waiting = $derived(data.toMe.filter((thread) => thread.status === 'open'));
	const answered = $derived(data.toMe.filter((thread) => thread.status !== 'open'));

	const STATUS: Record<string, { label: string; className: string }> = {
		open: { label: 'Waiting for an answer', className: 'chip-warn' },
		answered: { label: 'Answered', className: 'chip-good' },
		approved: { label: 'Approved', className: 'chip-good' },
		declined: { label: 'Not approved', className: 'chip-bad' },
		closed: { label: 'Closed', className: '' }
	};
</script>

<svelte:head>
	<title>North Pole Mail | Secret Santa</title>
</svelte:head>

<main class="page narrow stack">
	<div class="page-title">
		<h1>North Pole Mail</h1>
		<p>Anonymous questions and permission slips. Nobody's name is ever attached, and Santa keeps the secrets.</p>
	</div>

	{#if form?.message}
		<p class="alert {form.kind === 'bad' ? 'alert-bad' : 'alert-good'}" role="status">{form.message}</p>
	{/if}

	{#if !data.toMe.length && !data.fromMe.length}
		<section class="paper center rise">
			<SantaFace size={80} />
			<p>The mail sack is empty.</p>
			<p class="small muted-ink">Questions for you and permission slips about people you help will show up here.</p>
		</section>
	{/if}

	{#snippet incoming(thread: (typeof data.toMe)[number])}
		{@const status = thread.status === 'open' ? { label: 'Needs your answer', className: 'chip-bad' } : (STATUS[thread.status] ?? STATUS.open)}
				<article id="thread-{thread.id}" class="paper stitched letter rise" class:needs-answer={thread.status === 'open'}>
					<header class="row between">
						<span class="eyebrow">{thread.title}</span>
						<span class="chip {status.className}">{status.label}</span>
					</header>

					{#if thread.gift}
						<div class="gift">
							<Icon name="gift" size={20} />
							<div>
								<strong>{thread.gift.title}</strong>
								{#if thread.gift.price_text}<span class="small"> ({thread.gift.price_text})</span>{/if}
								{#if thread.gift.url}
									<a class="small link" href={thread.gift.url} target="_blank" rel="noopener noreferrer">See it <Icon name="external" size={13} /></a>
								{/if}
							</div>
						</div>
					{/if}

					<div class="messages">
						{#each thread.messages as message (message.id)}
							<div class="message" class:mine={message.mine}>
								<span class="who">{message.mine ? 'You' : 'Santa, passing along a note'}</span>
								<p>{message.body}</p>
								<time>{relativeTime(message.at)}</time>
							</div>
						{/each}
					</div>

					{#if thread.status === 'open' && thread.kind === 'approval'}
						<form method="POST" action="?/decide" class="stack-sm" use:enhance>
							<input type="hidden" name="thread" value={thread.id} />
							<div class="field">
								<label for="note-{thread.id}">A note back (optional)</label>
								<input id="note-{thread.id}" name="note" type="text" placeholder="Size 8, please!" />
							</div>
							<div class="row">
								<button class="btn btn-pine" name="decision" value="approve"><Icon name="check" size={18} /> Approve</button>
								<button class="btn btn-wax" name="decision" value="decline"><Icon name="x" size={18} /> Decline</button>
							</div>
						</form>
					{:else if thread.kind === 'question' && thread.status === 'open'}
						<form method="POST" action="?/reply" class="stack-sm" use:enhance>
							<input type="hidden" name="thread" value={thread.id} />
							<div class="field">
								<label for="reply-{thread.id}">Your answer</label>
								<textarea id="reply-{thread.id}" name="text" rows="2" required></textarea>
							</div>
							<button class="btn btn-wax btn-sm">Send answer</button>
						</form>
					{:else if thread.kind === 'question' && thread.status !== 'closed'}
						<details>
							<summary>Add to your answer</summary>
							<form method="POST" action="?/reply" class="stack-sm" use:enhance>
								<input type="hidden" name="thread" value={thread.id} />
								<div class="field">
									<label for="reply-{thread.id}">Anything else?</label>
									<textarea id="reply-{thread.id}" name="text" rows="2" required></textarea>
								</div>
								<button class="btn btn-pine btn-sm">Send</button>
							</form>
						</details>
					{/if}
				</article>
	{/snippet}

	{#if waiting.length}
		<section class="stack-sm">
			<h2 class="section">Waiting on you</h2>
			{#each waiting as thread (thread.id)}
				{@render incoming(thread)}
			{/each}
		</section>
	{/if}

	{#if answered.length}
		<section class="stack-sm">
			<h2 class="section">You've answered</h2>
			{#each answered as thread (thread.id)}
				{@render incoming(thread)}
			{/each}
		</section>
	{/if}

	{#if data.fromMe.length}
		<section class="stack-sm">
			<h2 class="section">What you've asked</h2>
			{#each data.fromMe as thread (thread.id)}
				{@const status = STATUS[thread.status] ?? STATUS.open}
				<article class="paper letter rise">
					<header class="row between">
						<span class="eyebrow">{thread.title}</span>
						<span class="chip {status.className}">{status.label}</span>
					</header>
					{#if thread.unread}<span class="chip chip-bad new">New answer</span>{/if}
					{#if thread.gift}
						<p class="gift"><Icon name="gift" size={20} /> <strong>{thread.gift.title}</strong></p>
					{/if}
					<div class="messages">
						{#each thread.messages as message (message.id)}
							<div class="message" class:mine={message.mine}>
								<span class="who">{message.mine ? 'You (reworded by Santa)' : 'The answer'}</span>
								{#if message.decision}
									<p class="decision {message.decision}">
										<Icon name={message.decision === 'approved' ? 'check' : 'x'} size={16} />
										{message.decision === 'approved' ? 'Approved' : 'Not approved'}
									</p>
								{/if}
								<p>{message.body}</p>
								<time>{message.pending ? 'An elf is on the way with this' : relativeTime(message.at)}</time>
							</div>
						{/each}
					</div>
					{#if thread.kind === 'question' && thread.status !== 'closed'}
						<details>
							<summary>Ask a follow-up</summary>
							<RelayComposer
								action="?/followUp"
								purpose="follow_up"
								disabled={!followUps[thread.id]?.trim()}
								extra={{ thread: thread.id }}
								buildText={() => followUps[thread.id] ?? ''}
								onsent={() => (followUps[thread.id] = '')}
							>
								{#snippet fields()}
									<div class="field">
										<label for="follow-{thread.id}">Your follow-up</label>
										<textarea id="follow-{thread.id}" rows="2" bind:value={followUps[thread.id]}></textarea>
									</div>
								{/snippet}
							</RelayComposer>
						</details>
					{/if}
				</article>
			{/each}
		</section>
	{/if}
</main>

<style>
	.section {
		color: var(--candle-200);
		font-size: 1.3rem;
		margin-top: 6px;
		text-shadow: 0 1px 6px rgba(3, 9, 17, 0.9);
	}

	.center {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 8px;
	}

	.letter {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.new {
		width: fit-content;
	}

	.needs-answer {
		box-shadow: 0 0 0 2px var(--cran-600), var(--shadow-card);
	}

	.letter:target {
		animation: arrive 1.6s ease-out;
	}

	@keyframes arrive {
		0%,
		40% {
			box-shadow: 0 0 0 4px var(--candle-400), 0 0 40px rgba(240, 195, 106, 0.7), var(--shadow-card);
		}
	}

	.gift {
		display: flex;
		align-items: flex-start;
		gap: 9px;
		padding: 10px 12px;
		border-radius: 12px;
		background: var(--paper-200);
		color: var(--ink-900);
	}

	.gift .link {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		margin-left: 8px;
	}

	.messages {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.message {
		padding: 10px 14px;
		border-radius: 12px;
		background: #fff;
		box-shadow: inset 0 0 0 1px var(--paper-300);
	}

	.message.mine {
		background: var(--paper-200);
		box-shadow: none;
	}

	.message p {
		white-space: pre-line;
	}

	.who {
		display: block;
		font-weight: 800;
		font-size: 0.8rem;
		color: var(--pine-700);
		margin-bottom: 2px;
	}

	time {
		display: block;
		font-size: 0.78rem;
		color: var(--ink-500);
		margin-top: 3px;
	}

	.decision {
		display: flex;
		align-items: center;
		gap: 5px;
		font-weight: 800;
	}

	.decision.approved {
		color: var(--pine-700);
	}

	.decision.declined {
		color: var(--cran-700);
	}

	details summary {
		cursor: pointer;
		font-weight: 800;
		color: var(--cran-700);
		margin-bottom: 8px;
	}
</style>
