<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { ActionCard } from '$lib/server/santa/actions';
	import Icon from './Icon.svelte';

	let { card: initial }: { card: ActionCard } = $props();

	// svelte-ignore state_referenced_locally
	let card = $state(initial);
	let busy = $state(false);
	let errorMessage = $state('');
	let editing = $state(false);
	// svelte-ignore state_referenced_locally
	let wording = $state(initial.body);

	async function decide(decision: 'confirm' | 'cancel') {
		busy = true;
		errorMessage = '';
		try {
			const response = await fetch(`/api/santa/action/${card.id}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ decision, ...(card.editable ? { text: wording } : {}) })
			});
			if (!response.ok) {
				const problem = (await response.json().catch(() => null)) as { message?: string } | null;
				throw new Error(problem?.message ?? 'That did not work. Please try again.');
			}
			card = ((await response.json()) as { card: ActionCard }).card;
			editing = false;
			void invalidateAll();
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'That did not work. Please try again.';
		} finally {
			busy = false;
		}
	}
</script>

<div class="card {card.status}">
	<p class="title"><Icon name="scroll" size={18} /> {card.title}</p>
	{#if editing}
		<label class="visually-hidden" for="edit-{card.id}">Wording</label>
		<textarea id="edit-{card.id}" rows="4" bind:value={wording}></textarea>
	{:else if card.body}
		<p class="body">{wording}</p>
	{/if}
	{#if card.bullets.length}
		<ul>
			{#each card.bullets as bullet}<li>{bullet}</li>{/each}
		</ul>
	{/if}
	{#if card.status === 'pending'}
		{#each card.notes as note}
			<p class="alert alert-warn note">{note}</p>
		{/each}
		{#if errorMessage}<p class="alert alert-bad note" role="alert">{errorMessage}</p>{/if}
		<div class="row buttons">
			<button class="btn btn-wax btn-sm" onclick={() => decide('confirm')} disabled={busy || (card.editable && !wording.trim())}>
				{busy ? 'One moment...' : card.confirmLabel}
			</button>
			{#if card.editable}
				<button class="btn btn-quiet btn-sm" onclick={() => (editing = !editing)} disabled={busy}>
					{editing ? 'Done editing' : 'Edit wording'}
				</button>
			{/if}
			<button class="btn btn-quiet btn-sm" onclick={() => decide('cancel')} disabled={busy}>{card.cancelLabel}</button>
		</div>
	{:else}
		<p class="result {card.status}">
			<Icon name={card.status === 'confirmed' ? 'check' : card.status === 'failed' ? 'x' : 'x'} size={16} />
			{card.result}
		</p>
	{/if}
</div>

<style>
	.card {
		background: #fff3d9;
		border-radius: 14px;
		padding: 14px;
		box-shadow: 0 0 0 2px var(--candle-500);
		display: flex;
		flex-direction: column;
		gap: 8px;
		color: var(--ink-900);
	}

	.card.cancelled,
	.card.failed {
		box-shadow: 0 0 0 1px var(--paper-300);
		background: var(--paper-200);
	}

	.card.confirmed {
		box-shadow: 0 0 0 2px var(--pine-500);
		background: #edf7f1;
	}

	.title {
		display: flex;
		align-items: center;
		gap: 7px;
		font-weight: 800;
		color: var(--cran-700);
		line-height: 1.25;
	}

	.confirmed .title {
		color: var(--pine-700);
	}

	.body {
		white-space: pre-line;
		font-size: 0.98rem;
	}

	ul {
		margin: 0;
		padding-left: 20px;
		font-size: 0.96rem;
	}

	.note {
		font-size: 0.88rem;
		padding: 8px 12px;
	}

	.buttons {
		gap: 8px;
	}

	.result {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		font-weight: 700;
		font-size: 0.93rem;
		color: var(--ink-700);
	}

	.result.confirmed {
		color: var(--pine-700);
	}

	.result.failed {
		color: var(--cran-700);
	}

	.result :global(svg) {
		margin-top: 3px;
	}
</style>
