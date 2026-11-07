<script lang="ts">
	import { enhance } from '$app/forms';
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	/**
	 * Write a message, let Santa reword it, check it, then send it. The sender always sees the exact
	 * words that will go out before anything is sent.
	 */
	let {
		action,
		purpose,
		buildText,
		fields,
		sendLabel = 'Send anonymously',
		rewordLabel = 'Let Santa reword it',
		disabled = false,
		extra,
		onsent
	}: {
		action: string;
		purpose: string;
		buildText: () => string;
		fields: Snippet;
		sendLabel?: string;
		rewordLabel?: string;
		disabled?: boolean;
		extra?: Record<string, string>;
		onsent?: () => void;
	} = $props();

	let reviewing = $state(false);
	let working = $state(false);
	let sending = $state(false);
	let wording = $state('');
	let notes = $state<string[]>([]);
	let rewritten = $state(true);
	let errorMessage = $state('');

	async function reword() {
		const text = buildText().trim();
		if (!text) return;
		working = true;
		errorMessage = '';
		try {
			const response = await fetch('/api/relay/preview', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text, purpose })
			});
			if (!response.ok) throw new Error();
			const result = (await response.json()) as { text: string; notes: string[]; rewritten: boolean };
			wording = result.text;
			notes = result.notes;
			rewritten = result.rewritten;
			reviewing = true;
		} catch {
			errorMessage = "Santa's quill broke. Please try again in a moment.";
		} finally {
			working = false;
		}
	}
</script>

<form
	method="POST"
	{action}
	class="stack-sm"
	use:enhance={() => {
		sending = true;
		return async ({ update, result }) => {
			await update({ reset: false });
			sending = false;
			if (result.type === 'success') {
				reviewing = false;
				onsent?.();
			}
		};
	}}
>
	<div class="write" class:hidden={reviewing}>
		{@render fields()}
		{#if errorMessage}<p class="alert alert-bad" role="alert">{errorMessage}</p>{/if}
		<button class="btn btn-wax" type="button" onclick={reword} disabled={working || disabled}>
			<Icon name="wand" size={18} />
			{working ? 'Santa is rewording...' : rewordLabel}
		</button>
	</div>

	{#if reviewing}
		<div class="review rise">
			<p class="eyebrow">{rewritten ? 'Santa reworded it. Check it over:' : 'Check it over:'}</p>
			<div class="field">
				<label class="visually-hidden" for="wording-{purpose}">Message that will be sent</label>
				<textarea id="wording-{purpose}" name="text" rows="4" bind:value={wording} required></textarea>
			</div>
			{#each notes as note}
				<p class="alert alert-warn small">{note}</p>
			{/each}
			<div class="row">
				<button class="btn btn-wax" disabled={sending || !wording.trim()}>
					<Icon name="send" size={18} />
					{sending ? 'Sending...' : sendLabel}
				</button>
				<button class="btn btn-quiet" type="button" onclick={() => (reviewing = false)}>Back</button>
			</div>
		</div>
	{/if}
	{#each Object.entries(extra ?? {}) as [name, value]}
		<input type="hidden" {name} {value} />
	{/each}
</form>

<style>
	.write,
	.review {
		display: flex;
		flex-direction: column;
		gap: 10px;
		align-items: stretch;
	}

	.write.hidden {
		display: none;
	}

	.write > :global(button) {
		align-self: flex-start;
	}
</style>
