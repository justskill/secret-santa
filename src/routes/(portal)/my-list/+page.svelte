<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import FlipCountdown from '$lib/components/FlipCountdown.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import WishCard from '$lib/components/WishCard.svelte';
	import { formatDate } from '$lib/time';

	let { data, form } = $props();

	const helping = $derived(data.viewer?.helping ?? false);
	const firstName = $derived(data.viewer?.profile.firstName ?? '');
	const possessive = $derived(helping ? `${firstName}'s` : 'Your');

	// New wish form
	let url = $state('');
	let title = $state('');
	let price = $state('');
	let imageUrl = $state('');
	let fetching = $state(false);
	let fetchNote = $state('');

	async function fetchDetails() {
		if (!url.trim()) return;
		fetching = true;
		fetchNote = '';
		try {
			const response = await fetch('/api/link-preview', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url })
			});
			if (!response.ok) {
				fetchNote = "That link doesn't look right. It should start with https://";
				return;
			}
			const preview = (await response.json()) as { title: string | null; image: string | null; price: string | null; blocked: boolean };
			if (preview.title) title = preview.title;
			if (preview.price) price = preview.price;
			imageUrl = preview.image ?? '';
			fetchNote = preview.blocked || !preview.title ? "This store doesn't share its details, so please type the name below." : 'Found it! Check the details below.';
		} catch {
			fetchNote = "Santa couldn't reach that store. Please type the details below.";
		} finally {
			fetching = false;
		}
	}

	// Editing
	let editing = $state<number | null>(null);

	// Hidden by default, because the kid may be looking at the same screen.
	let showCovered = $state(false);

	// Paste or import
	let pasteText = $state('');
	let extracting = $state(false);
	let importNote = $state('');
	let importing = $state(false);
	let found = $state<{ title: string; url: string | null; image_url?: string | null; price_text: string | null; notes?: string | null; keep: boolean }[]>([]);
	const keptItems = $derived(found.filter((item) => item.keep));
	const keptJson = $derived(JSON.stringify(keptItems.map(({ keep, ...item }) => item)));

	async function extractFromPaste() {
		if (!pasteText.trim()) return;
		extracting = true;
		importNote = '';
		found = [];
		try {
			const response = await fetch('/api/lists/extract', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text: pasteText })
			});
			const result = (await response.json()) as { items?: typeof found; message?: string };
			if (!response.ok || !result.items) {
				importNote = result.message ?? "Santa couldn't read that. You can add wishes one at a time instead.";
				return;
			}
			found = result.items.map((item) => ({ ...item, keep: true }));
			if (!found.length) importNote = "Santa didn't find any gift ideas in that text.";
		} catch {
			importNote = "Santa couldn't read that. You can add wishes one at a time instead.";
		} finally {
			extracting = false;
		}
	}

	async function importAmazon() {
		importing = true;
		importNote = '';
		found = [];
		try {
			const response = await fetch('/api/lists/import-amazon', { method: 'POST' });
			const result = (await response.json()) as { items?: typeof found; message?: string };
			if (!response.ok || !result.items) {
				importNote = result.message ?? "Amazon wouldn't let the elves in.";
				return;
			}
			found = result.items.map((item) => ({ ...item, keep: true }));
		} catch {
			importNote = "Amazon wouldn't let the elves in.";
		} finally {
			importing = false;
		}
	}

	const resetAdd = () => {
		url = '';
		title = '';
		price = '';
		imageUrl = '';
		fetchNote = '';
	};
</script>

<svelte:head>
	<title>{possessive} wish list | Secret Santa</title>
</svelte:head>

<main class="page stack">
	<div class="page-title">
		<h1>{possessive} wish list</h1>
		<p>Only you{helping ? ` (and ${firstName}'s other grown-ups)` : ''} and whoever drew {helping ? firstName : 'you'} can see this list.</p>
	</div>

	{#if !data.hasSeason}
		<section class="paper"><p class="empty">The workshop isn't open yet. Check back soon!</p></section>
	{:else}
		{#if form?.message}
			<p class="alert {page.status >= 400 ? 'alert-bad' : 'alert-good'}" role="status">{form.message}</p>
		{/if}
		{#if data.locked}
			<p class="alert alert-warn"><Icon name="lock" size={16} /> The list deadline has passed, so this list is locked.</p>
		{/if}

		<div class="grid-2 wide-left">
			<section class="paper stitched">
				<div class="row between">
					<h2>The list</h2>
					{#if data.meta.ready_at}<span class="chip chip-good"><Icon name="check" size={14} /> Ready</span>{/if}
				</div>
				{#if helping && data.items.length}
					<div class="grownups">
						<label class="check small">
							<input type="checkbox" bind:checked={showCovered} />
							<span>Grown-ups only: show what's already been bought<small>So you don't buy the same thing. It won't say who bought it.</small></span>
						</label>
					</div>
				{/if}
				{#if data.items.length}
					<div class="items">
						{#each data.items as item (item.id)}
							{#if editing === item.id}
								<form
									method="POST"
									action="?/update"
									class="edit stack-sm"
									use:enhance={() =>
										async ({ update }) => {
											await update({ reset: false });
											editing = null;
										}}
								>
									<input type="hidden" name="id" value={item.id} />
									<input type="hidden" name="image_url" value={item.image_url ?? ''} />
									<div class="field">
										<label for="edit-title">Name</label>
										<input id="edit-title" name="title" type="text" value={item.title} required />
									</div>
									<div class="form-grid two">
										<div class="field">
											<label for="edit-price">Price</label>
											<input id="edit-price" name="price_text" type="text" value={item.price_text ?? ''} />
										</div>
										<div class="field">
											<label for="edit-priority">How much</label>
											<select id="edit-priority" name="priority" value={String(item.priority)}>
												<option value="1">Really wants</option>
												<option value="2">Would like</option>
												<option value="3">Nice to have</option>
											</select>
										</div>
									</div>
									<div class="field">
										<label for="edit-url">Link</label>
										<input id="edit-url" name="url" type="url" value={item.url ?? ''} />
									</div>
									<div class="field">
										<label for="edit-notes">Notes</label>
										<textarea id="edit-notes" name="notes" rows="2">{item.notes}</textarea>
									</div>
									<div class="row">
										<button class="btn btn-pine btn-sm">Save</button>
										<button class="btn btn-quiet btn-sm" type="button" onclick={() => (editing = null)}>Cancel</button>
									</div>
								</form>
							{:else}
								<WishCard {item}>
									{#if showCovered && data.covered?.includes(item.id)}
										<span class="chip chip-good covered"><Icon name="check" size={13} /> Someone has this covered</span>
									{/if}
									{#if !data.locked}
										<div class="row item-actions">
											<button class="btn-link small" type="button" onclick={() => (editing = item.id)}>Edit</button>
											<form method="POST" action="?/remove" use:enhance>
												<input type="hidden" name="id" value={item.id} />
												<button class="btn-link small">Remove</button>
											</form>
										</div>
									{/if}
								</WishCard>
							{/if}
						{/each}
					</div>
				{:else}
					<p class="empty">
						Nothing here yet. Add a wish, paste a list, or ask <a href="/santa">Santa</a> for ideas.
					</p>
				{/if}

				{#if data.meta.amazon_url}
					<hr class="divider" />
					<a class="amazon-link" href={data.meta.amazon_url} target="_blank" rel="noopener noreferrer">
						<Icon name="link" size={18} /> Your Amazon list is linked <Icon name="external" size={14} />
					</a>
				{/if}

				{#if !data.locked}
					<hr class="divider" />
					<form method="POST" action="?/ready" use:enhance class="ready">
						<input type="hidden" name="ready" value={data.meta.ready_at ? '0' : '1'} />
						{#if data.meta.ready_at}
							<p class="small muted">Marked ready. You can keep editing, and {helping ? `${firstName}'s` : 'your'} Santa will hear about new wishes.</p>
							<button class="btn btn-quiet btn-sm">Reopen the list</button>
						{:else}
							<p class="small muted">All done? Santa will tell {helping ? `${firstName}'s` : 'your'} shopper the list is ready.</p>
							<button class="btn btn-wax" disabled={!data.items.length && !data.meta.amazon_url}>
								<Icon name="check" size={18} /> My list is ready
							</button>
						{/if}
					</form>
				{/if}
			</section>

			<div class="stack">
				{#if data.deadline}
					<FlipCountdown
						target={data.deadline.target_at}
						title={data.deadline.title}
						dateLabel={formatDate(data.deadline.target_at, data.timeZone)}
						size="small"
					/>
				{/if}

				{#if !data.locked}
					<section class="paper">
						<h2>Add a wish</h2>
						<form
							method="POST"
							action="?/add"
							class="stack-sm add-form"
							use:enhance={() =>
								async ({ update, result }) => {
									await update();
									if (result.type === 'success') resetAdd();
								}}
						>
							<div class="field">
								<label for="url">Link to the item (any store)</label>
								<div class="row nowrap">
									<input id="url" name="url" type="url" inputmode="url" placeholder="https://..." bind:value={url} onblur={fetchDetails} />
									<button class="btn btn-quiet btn-sm" type="button" onclick={fetchDetails} disabled={fetching || !url.trim()}>
										{fetching ? '...' : 'Fetch'}
									</button>
								</div>
								{#if fetchNote}<span class="field-hint" role="status">{fetchNote}</span>{/if}
							</div>
							<input type="hidden" name="image_url" value={imageUrl} />
							{#if imageUrl}<img class="fetched" src={imageUrl} alt="" />{/if}
							<div class="field">
								<label for="title">What is it?</label>
								<input id="title" name="title" type="text" bind:value={title} required />
							</div>
							<div class="form-grid two">
								<div class="field">
									<label for="price">Price (optional)</label>
									<input id="price" name="price_text" type="text" bind:value={price} />
								</div>
								<div class="field">
									<label for="priority">How much?</label>
									<select id="priority" name="priority">
										<option value="1">Really want</option>
										<option value="2" selected>Would like</option>
										<option value="3">Nice to have</option>
									</select>
								</div>
							</div>
							<div class="field">
								<label for="notes">Notes (size, color, anything helpful)</label>
								<textarea id="notes" name="notes" rows="2"></textarea>
							</div>
							<button class="btn btn-pine btn-block"><Icon name="plus" size={18} /> Add to the list</button>
						</form>
					</section>

					<section class="paper">
						<h2>Amazon list</h2>
						<p class="small muted form-intro">Paste the share link to your Amazon list, and your Santa gets a button to open it. Make sure the list is set to Public or Shared.</p>
						<form method="POST" action="?/amazon" use:enhance={() => async ({ update }) => update({ reset: false })} class="stack-sm">
							<div class="field">
								<label for="amazon">Amazon list link</label>
								<input id="amazon" name="amazon_url" type="url" placeholder="https://www.amazon.com/hz/wishlist/ls/..." value={data.meta.amazon_url ?? ''} />
							</div>
							<div class="row">
								<button class="btn btn-pine btn-sm">Save link</button>
								{#if data.meta.amazon_url}
									<button class="btn btn-quiet btn-sm" type="button" onclick={importAmazon} disabled={importing}>
										{importing ? 'Sending an elf...' : 'Try importing the items'}
									</button>
								{/if}
							</div>
						</form>
					</section>

					<section class="paper">
						<h2>Paste a whole list</h2>
						<p class="small muted form-intro">Paste a list from anywhere, even a copied Amazon page, and Santa will sort it into wishes.</p>
						<div class="stack-sm">
							<div class="field">
								<label for="paste">Your list</label>
								<textarea id="paste" rows="4" bind:value={pasteText} placeholder="Blue scarf, the good headphones, size 9 slippers..."></textarea>
							</div>
							<button class="btn btn-quiet" type="button" onclick={extractFromPaste} disabled={extracting || !pasteText.trim() || !data.aiReady}>
								<Icon name="wand" size={18} /> {extracting ? 'Santa is reading...' : 'Let Santa sort it'}
							</button>
							{#if !data.aiReady}<p class="field-hint">Santa's helper is resting right now, so add wishes one at a time.</p>{/if}
						</div>
					</section>

					{#if importNote || found.length}
						<section class="paper found" aria-live="polite">
							<h2>What Santa found</h2>
							{#if importNote}<p class="alert alert-warn">{importNote}</p>{/if}
							{#if found.length}
								<ul>
									{#each found as item}
										<li>
											<label class="check">
												<input type="checkbox" bind:checked={item.keep} />
												<span>{item.title}{#if item.price_text}<small>{item.price_text}</small>{/if}</span>
											</label>
										</li>
									{/each}
								</ul>
								<form
									method="POST"
									action="?/addMany"
									use:enhance={() =>
										async ({ update, result }) => {
											await update();
											if (result.type === 'success') {
												found = [];
												pasteText = '';
											}
										}}
								>
									<input type="hidden" name="items" value={keptJson} />
									<button class="btn btn-pine btn-block" disabled={!keptItems.length}>
										Add {keptItems.length} to the list
									</button>
								</form>
							{/if}
						</section>
					{/if}
				{/if}

				<section class="paper">
					<h2>Notes for {helping ? `${firstName}'s` : 'your'} Santa</h2>
					<form method="POST" action="?/note" use:enhance={() => async ({ update }) => update({ reset: false })} class="stack-sm">
						<div class="field">
							<label for="intro">A note at the top of the list</label>
							<textarea id="intro" name="intro_note" rows="2" disabled={data.locked} placeholder="Thanks, Santa! Anything warm is great.">{data.meta.intro_note}</textarea>
						</div>
						<div class="field">
							<label for="guidance">Sizes, likes, and things to avoid</label>
							<textarea id="guidance" name="notes" rows="3" disabled={data.locked} placeholder="Shirt size M. No candles, please.">{data.guidance.notes}</textarea>
						</div>
						{#if !data.locked}<button class="btn btn-pine btn-sm">Save notes</button>{/if}
					</form>
				</section>
			</div>
		</div>
	{/if}
</main>

<style>
	.items {
		margin-top: 4px;
	}

	.item-actions {
		gap: 16px;
	}

	.grownups {
		margin-top: 10px;
		padding: 10px 12px;
		border-radius: 12px;
		background: var(--paper-200);
	}

	.covered {
		margin-bottom: 6px;
	}

	.edit {
		padding: 14px;
		margin: 10px 0;
		border-radius: 14px;
		background: var(--paper-200);
	}

	.ready {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
	}

	.amazon-link {
		display: inline-flex;
		align-items: center;
		gap: 7px;
	}

	.form-intro {
		margin: 4px 0 10px;
	}

	.add-form {
		margin-top: 10px;
	}

	.fetched {
		width: 84px;
		height: 84px;
		object-fit: contain;
		border-radius: 12px;
		background: #fff;
	}

	.found ul {
		list-style: none;
		margin: 12px 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.found small {
		margin-left: 6px;
		display: inline;
	}
</style>
