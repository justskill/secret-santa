<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import { relativeTime } from '$lib/time';

	let { data, form } = $props();
</script>

<main class="page narrow stack">
	<div class="page-title">
		<h1>Announcements</h1>
		<p>Post something that everyone sees the next time they sign in. It's for news like "the gift exchange moved to Saturday".</p>
	</div>

	{#if form?.message}
		<p class="alert {form.ok ? 'alert-good' : 'alert-bad'}" role="status">{form.message}</p>
	{/if}

	<section class="paper stitched">
		<form method="POST" action="?/post" class="stack-sm" use:enhance>
			<div class="field">
				<label for="title">Headline</label>
				<input id="title" name="title" type="text" required />
			</div>
			<div class="field">
				<label for="body">More detail (optional)</label>
				<textarea id="body" name="body" rows="3"></textarea>
			</div>
			<button class="btn btn-wax"><Icon name="send" size={18} /> Post to everyone</button>
		</form>
	</section>

	<section class="paper">
		<h2>Your announcements</h2>
		{#if data.notices.length}
			<ul>
				{#each data.notices as notice (notice.id)}
					<li>
						<div class="grow">
							<strong>{notice.title}</strong>
							{#if notice.body}<p class="small">{notice.body}</p>{/if}
							<p class="small muted-ink">{relativeTime(notice.created_at)}</p>
						</div>
						<form method="POST" action="?/delete" use:enhance>
							<input type="hidden" name="id" value={notice.id} />
							<button class="btn-link small">Remove</button>
						</form>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="empty">Nothing yet.</p>
		{/if}
	</section>
</main>

<style>
	ul {
		list-style: none;
		margin: 10px 0 0;
		padding: 0;
	}

	li {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 12px 0;
		border-bottom: 1.5px dashed var(--paper-300);
	}

	li:last-child {
		border-bottom: 0;
	}
</style>
