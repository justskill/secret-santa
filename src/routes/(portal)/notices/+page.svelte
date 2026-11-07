<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidate } from '$app/navigation';
	import NoticeRow from '$lib/components/NoticeRow.svelte';
	import WaitingMail from '$lib/components/WaitingMail.svelte';

	let { data } = $props();

	// Loading this page marks everything read, so the badge can clear now.
	onMount(() => void invalidate('app:badges'));
</script>

<svelte:head>
	<title>Notices | Secret Santa</title>
</svelte:head>

<main class="page narrow stack">
	<div class="page-title">
		<h1>From the North Pole</h1>
		<p>News, reminders, and mail alerts from Santa.</p>
	</div>
	{#if data.waiting.length}
		<WaitingMail items={data.waiting} />
	{/if}

	<section class="paper rise">
		{#if data.notices.length}
			<ul>
				{#each data.notices as notice (notice.id)}
					<NoticeRow {notice} />
				{/each}
			</ul>
		{:else}
			<p class="empty">The mail sack is empty. Check back soon.</p>
		{/if}
	</section>
</main>

<style>
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
</style>
