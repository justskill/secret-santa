<script lang="ts">
	import { tick } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import ActionCardView from '$lib/components/ActionCardView.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Ornament from '$lib/components/Ornament.svelte';
	import SantaFace from '$lib/components/SantaFace.svelte';
	import { renderMarkdown } from '$lib/markdown';
	import type { ActionCard } from '$lib/server/santa/actions';

	let { data } = $props();

	interface Line {
		key: string;
		role: 'user' | 'assistant' | 'event';
		text: string;
		cards: ActionCard[];
		by: string | null;
	}

	// The chat grows locally as messages stream in, so only its starting point comes from the server.
	// svelte-ignore state_referenced_locally
	let lines = $state<Line[]>(
		data.turns
			.filter((turn) => turn.role !== 'event')
			.map((turn) => ({ key: `t${turn.id}`, role: turn.role, text: turn.text, cards: turn.cards, by: turn.by }))
	);
	let draft = $state('');
	let busy = $state(false);
	let status = $state('');
	let errorMessage = $state('');
	let scroller = $state<HTMLDivElement>();
	let lineCounter = 0;

	const viewer = $derived(data.viewer!);
	const firstName = $derived(viewer.profile.firstName);

	const starters = $derived.by(() => {
		const own = viewer.helping ? `${firstName}'s` : 'my';
		const list = data.hasDrawn
			? [`What's on ${own === 'my' ? 'my' : `${firstName}'s`} person's list?`, `Help me think of a gift for ${viewer.helping ? `${firstName}'s` : 'my'} person`, 'Ask my person an anonymous question']
			: [`Help me come up with ideas for ${own} list`];
		return [...list, 'When is everything due?', 'What are the rules again?'];
	});

	async function scrollDown() {
		await tick();
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
		window.scrollTo({ top: document.documentElement.scrollHeight });
	}

	$effect(() => {
		void scrollDown();
	});

	async function send(text: string) {
		const message = text.trim();
		if (!message || busy) return;
		draft = '';
		busy = true;
		status = 'Santa is putting on his glasses...';
		errorMessage = '';
		lines.push({ key: `n${lineCounter++}`, role: 'user', text: message, cards: [], by: null });
		const replyIndex = lines.push({ key: `n${lineCounter++}`, role: 'assistant', text: '', cards: [], by: null }) - 1;
		void scrollDown();

		try {
			const response = await fetch('/api/santa/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message })
			});
			if (!response.ok || !response.body) throw new Error('bad response');

			const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
			let buffer = '';
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += value;
				let boundary: number;
				while ((boundary = buffer.indexOf('\n\n')) !== -1) {
					const chunk = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + 2);
					if (!chunk.startsWith('data: ')) continue;
					const event = JSON.parse(chunk.slice(6)) as
						| { type: 'text'; text: string }
						| { type: 'replace'; text: string }
						| { type: 'status'; text: string }
						| { type: 'card'; card: ActionCard }
						| { type: 'error'; text: string }
						| { type: 'done' };
					if (event.type === 'text') {
						lines[replyIndex].text += event.text;
						status = '';
					} else if (event.type === 'replace') {
						lines[replyIndex].text = event.text;
					} else if (event.type === 'status') {
						status = event.text;
					} else if (event.type === 'card') {
						lines[replyIndex].cards.push(event.card);
					} else if (event.type === 'error') {
						errorMessage = event.text;
					}
					void scrollDown();
				}
			}
			if (!lines[replyIndex].text && !lines[replyIndex].cards.length && !errorMessage) {
				errorMessage = "Santa didn't catch that. Please try again.";
			}
		} catch {
			errorMessage = "Santa's sleigh hit some turbulence. Please try again in a moment.";
		} finally {
			if (!lines[replyIndex].text && !lines[replyIndex].cards.length) lines.splice(replyIndex, 1);
			busy = false;
			status = '';
			void invalidateAll();
			void scrollDown();
		}
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			void send(draft);
		}
	}
</script>

<svelte:head>
	<title>Chat with Santa | Secret Santa</title>
</svelte:head>

<main class="page narrow chat">
	{#if !data.hasSeason}
		<section class="paper"><p class="empty">The workshop isn't open yet. Check back soon!</p></section>
	{:else}
		<div class="transcript" bind:this={scroller} aria-live="polite">
			<div class="line santa rise">
				<div class="avatar"><SantaFace size={52} /></div>
				<div class="bubble paper-bubble">
					<p class="hand first">Ho ho ho, {firstName}!</p>
					<p>
						I can help with {data.hasDrawn ? 'gift ideas for your person, your wish list, anonymous questions, and permission slips' : 'your wish list, the rules, and the dates'}.
						{#if !data.hasDrawn}Once you've opened your name, I can help you shop too.{/if}
						And no, I can't tell you who drew you. Even I don't peek!
					</p>
				</div>
			</div>

			{#each lines as line (line.key)}
				{#if line.role === 'user'}
					<div class="line me">
						<div class="bubble my-bubble">
							<p>{line.text}</p>
							{#if line.by && line.by !== viewer.profile.name}<small>from {line.by}</small>{/if}
						</div>
						<div class="avatar"><Ornament name={viewer.profile.name} color={viewer.profile.color} photo={viewer.profile.photo} size={38} label={false} /></div>
					</div>
				{:else}
					<div class="line santa">
						<div class="avatar"><SantaFace size={52} /></div>
						<div class="column">
							{#if line.text}
								<div class="bubble paper-bubble rich">{@html renderMarkdown(line.text)}</div>
							{/if}
							{#each line.cards as card (card.id)}
								<ActionCardView {card} />
							{/each}
						</div>
					</div>
				{/if}
			{/each}

			{#if status}
				<p class="status hand" role="status"><span class="bells" aria-hidden="true"></span>{status}</p>
			{/if}
			{#if errorMessage}<p class="alert alert-bad" role="alert">{errorMessage}</p>{/if}
		</div>

		{#if lines.length === 0}
			<div class="starters">
				{#each starters as starter}
					<button class="chip-btn" onclick={() => send(starter)}>{starter}</button>
				{/each}
			</div>
		{/if}

		<form
			class="composer"
			onsubmit={(event) => {
				event.preventDefault();
				void send(draft);
			}}
		>
			<label class="visually-hidden" for="message">Message to Santa</label>
			<textarea id="message" rows="1" bind:value={draft} onkeydown={onKeydown} maxlength={2000} placeholder="Write to Santa..."></textarea>
			<button class="send" disabled={busy || !draft.trim()} aria-label="Send">
				<Icon name="send" size={20} />
			</button>
		</form>
		<p class="fineprint">Santa is an AI, and can make mistakes. Check anything important.</p>
	{/if}
</main>

<style>
	.chat {
		display: flex;
		flex-direction: column;
		gap: 14px;
		min-height: calc(100dvh - 72px);
		padding-bottom: calc(var(--tab-height) + var(--safe-bottom) + 96px);
	}

	.transcript {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.line {
		display: flex;
		align-items: flex-start;
		gap: 9px;
		min-width: 0;
	}

	.line.me {
		justify-content: flex-end;
	}

	.avatar {
		flex: none;
	}

	.column {
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 0;
		flex: 1;
		max-width: 86%;
	}

	.bubble {
		padding: 12px 16px;
		border-radius: 18px;
		min-width: 0;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}

	.paper-bubble {
		background-color: var(--paper-100);
		background-image: var(--paper-grain);
		color: var(--ink-900);
		border-top-left-radius: 5px;
		box-shadow: var(--shadow-card);
		width: fit-content;
	}

	.paper-bubble :global(a) {
		color: var(--cran-700);
		font-weight: 700;
	}

	.rich :global(p) {
		margin: 0;
	}

	.rich :global(p + p),
	.rich :global(ul),
	.rich :global(ol) {
		margin-top: 8px;
	}

	.rich :global(ul),
	.rich :global(ol) {
		margin-bottom: 0;
		padding-left: 22px;
	}

	.rich :global(li + li) {
		margin-top: 4px;
	}

	.first {
		color: var(--cran-700);
		font-size: 1.6rem;
	}

	.my-bubble {
		max-width: 80%;
		background: linear-gradient(170deg, var(--pine-500), var(--pine-700));
		color: #f4fffa;
		border-top-right-radius: 5px;
	}

	.my-bubble p {
		white-space: pre-wrap;
	}

	.my-bubble small {
		display: block;
		opacity: 0.75;
		font-size: 0.78rem;
		margin-top: 2px;
	}

	.status {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--candle-200);
		font-size: 1.4rem;
		padding-left: 60px;
		text-shadow: 0 1px 6px rgba(3, 9, 17, 0.9);
	}

	.bells {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex: none;
		background: var(--candle-400);
		animation: pulse 0.9s ease-in-out infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 0.35;
			transform: scale(0.8);
		}
		50% {
			opacity: 1;
			transform: scale(1.2);
		}
	}

	.starters {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.chip-btn {
		padding: 9px 14px;
		border-radius: 999px;
		border: 1.5px solid rgba(240, 195, 106, 0.55);
		background: var(--frost-bg);
		color: var(--candle-200);
		font-weight: 700;
		font-size: 0.94rem;
		text-align: left;
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.chip-btn:hover {
		background: var(--frost-bg-hover);
	}

	.composer {
		position: fixed;
		left: 0;
		right: 0;
		bottom: calc(var(--tab-height) + var(--safe-bottom) + 22px);
		z-index: 12;
		display: flex;
		align-items: flex-end;
		gap: 8px;
		width: min(100% - 24px, 696px);
		margin: 0 auto;
		padding: 6px;
		border-radius: 28px;
		background: var(--paper-100);
		box-shadow: 0 16px 40px -10px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.4);
	}

	.composer textarea {
		flex: 1;
		border: 0;
		background: transparent;
		min-height: 44px;
		max-height: 140px;
		resize: none;
		padding: 10px 14px;
		field-sizing: content;
	}

	.composer textarea:focus {
		box-shadow: none;
	}

	.send {
		display: grid;
		place-items: center;
		flex: none;
		width: 44px;
		height: 44px;
		border-radius: 50%;
		border: 0;
		cursor: pointer;
		color: #fff4dc;
		background: radial-gradient(120% 140% at 30% 15%, var(--cran-500), var(--cran-700) 60%, var(--cran-800));
	}

	.send[disabled] {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.fineprint {
		position: fixed;
		left: 0;
		right: 0;
		bottom: calc(var(--tab-height) + var(--safe-bottom) + 3px);
		z-index: 12;
		text-align: center;
		font-size: 0.72rem;
		color: var(--snow);
		text-shadow: 0 1px 4px rgba(3, 9, 17, 0.95);
	}

	@media (min-width: 860px) {
		.composer {
			bottom: 34px;
		}
		.fineprint {
			bottom: 12px;
		}
		.chat {
			padding-bottom: 130px;
		}
	}
</style>
