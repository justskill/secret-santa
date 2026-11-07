<script lang="ts">
	import Icon from './Icon.svelte';

	/** Mail that needs an answer. It stays up after being read, and only an answer clears it. */
	let { items }: { items: { id: string; kind: string; title: string; excerpt: string }[] } = $props();
</script>

<section class="waiting rise" aria-label="Mail waiting for your answer">
	<header>
		<Icon name="mail" size={24} />
		<h2>{items.length === 1 ? 'An elf is waiting to hear from you' : `${items.length} elves are waiting to hear from you`}</h2>
	</header>
	<ul>
		{#each items as item (item.id)}
			<li>
				<a href="/mail#thread-{item.id}">
					<span class="text">
						<strong>{item.title}</strong>
						<span class="excerpt">{item.excerpt}</span>
					</span>
					<span class="btn btn-gold btn-sm">{item.kind === 'approval' ? 'Decide' : 'Answer'}</span>
				</a>
			</li>
		{/each}
	</ul>
</section>

<style>
	.waiting {
		padding: 16px 18px;
		border-radius: var(--radius);
		color: #fff4dc;
		background: linear-gradient(135deg, var(--cran-600), var(--cran-800));
		box-shadow: 0 0 0 2px rgba(240, 195, 106, 0.55), var(--shadow-card);
	}

	header {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	h2 {
		font-size: 1.2rem;
		color: var(--candle-200);
	}

	ul {
		list-style: none;
		margin: 10px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	a {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 12px;
		border-radius: 12px;
		text-decoration: none;
		color: inherit;
		background: rgba(60, 8, 20, 0.45);
		transition: background 0.15s ease;
	}

	a:hover {
		background: rgba(60, 8, 20, 0.7);
	}

	.text {
		display: flex;
		flex-direction: column;
		min-width: 0;
		line-height: 1.3;
	}

	.excerpt {
		font-size: 0.92rem;
		opacity: 0.9;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.btn {
		flex: none;
	}
</style>
