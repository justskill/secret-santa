<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	interface Wish {
		id: number;
		title: string;
		url: string | null;
		image_url: string | null;
		price_text: string | null;
		notes: string;
		priority: number;
	}

	let { item, children, muted = false }: { item: Wish; children?: Snippet; muted?: boolean } = $props();
	let imageFailed = $state(false);

	const PRIORITY: Record<number, { label: string; className: string }> = {
		1: { label: 'Really wants', className: 'chip-bad' },
		2: { label: 'Would like', className: '' },
		3: { label: 'Nice to have', className: '' }
	};
	const priority = $derived(PRIORITY[item.priority] ?? PRIORITY[2]);
	const host = $derived.by(() => {
		if (!item.url) return null;
		try {
			return new URL(item.url).hostname.replace(/^www\./, '');
		} catch {
			return null;
		}
	});
</script>

<article class="wish" class:muted>
	<div class="art">
		{#if item.image_url && !imageFailed}
			<img src={item.image_url} alt="" loading="lazy" onerror={() => (imageFailed = true)} />
		{:else}
			<Icon name="gift" size={30} />
		{/if}
	</div>
	<div class="body">
		<h3>{item.title}</h3>
		<div class="meta">
			<span class="chip {priority.className}">{priority.label}</span>
			{#if item.price_text}<span class="chip">{item.price_text}</span>{/if}
		</div>
		{#if item.notes}<p class="notes">{item.notes}</p>{/if}
		{#if item.url}
			<a class="shop" href={item.url} target="_blank" rel="noopener noreferrer">
				{host ?? 'Open link'}
				<Icon name="external" size={14} />
			</a>
		{/if}
		{#if children}<div class="extra">{@render children()}</div>{/if}
	</div>
</article>

<style>
	.wish {
		display: flex;
		gap: 14px;
		padding: 14px 0;
		border-bottom: 1.5px dashed var(--paper-300);
	}

	.wish:last-child {
		border-bottom: 0;
	}

	.wish.muted .art,
	.wish.muted h3 {
		opacity: 0.55;
	}

	.art {
		flex: none;
		width: 76px;
		height: 76px;
		border-radius: 14px;
		overflow: hidden;
		display: grid;
		place-items: center;
		background: var(--paper-200);
		color: var(--cran-600);
		box-shadow: inset 0 0 0 1px rgba(42, 31, 22, 0.08);
	}

	.art img {
		width: 100%;
		height: 100%;
		object-fit: contain;
		background: #fff;
	}

	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	h3 {
		font-size: 1.08rem;
		color: var(--ink-900) !important;
		line-height: 1.25;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
	}

	.notes {
		font-size: 0.94rem;
		color: var(--ink-700);
		line-height: 1.4;
	}

	.shop {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		width: fit-content;
		font-size: 0.92rem;
	}

	.extra {
		margin-top: 4px;
	}
</style>
