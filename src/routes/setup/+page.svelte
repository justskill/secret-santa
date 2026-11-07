<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import SantaFace from '$lib/components/SantaFace.svelte';

	let { data, form } = $props();
	let busy = $state(false);
	let timeZone = $state('');

	onMount(() => {
		timeZone = form?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
	});
</script>

<svelte:head>
	<title>Set up | Secret Santa</title>
</svelte:head>

<main class="setup">
	<section class="paper stitched card rise">
		<div class="head">
			<SantaFace size={84} />
			<h1>Open the workshop</h1>
			<p class="muted-ink">You'll be the head elf. You can add the rest of the family next.</p>
		</div>
		<form
			method="POST"
			class="stack-sm"
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					await update({ reset: false });
					busy = false;
				};
			}}
		>
			{#if form?.message}<p class="alert alert-bad" role="alert">{form.message}</p>{/if}
			<div class="field">
				<label for="token">Setup code</label>
				<input id="token" name="token" type="text" value={form?.token ?? data.token} required />
				<span class="field-hint">This is printed in the server log when the app starts.</span>
			</div>
			<div class="field">
				<label for="family">Family name</label>
				<input id="family" name="family" type="text" placeholder="The Claus Family" value={form?.family ?? ''} />
			</div>
			<div class="field">
				<label for="name">Your name</label>
				<input id="name" name="name" type="text" autocomplete="name" value={form?.name ?? ''} required />
			</div>
			<div class="field">
				<label for="username">Sign-in name</label>
				<input id="username" name="username" type="text" autocomplete="username" autocapitalize="none" value={form?.username ?? ''} required />
			</div>
			<div class="field">
				<label for="password">Password</label>
				<input id="password" name="password" type="password" autocomplete="new-password" minlength={data.minLength} required />
			</div>
			<div class="field">
				<label for="timezone">Time zone</label>
				<input id="timezone" name="timezone" type="text" bind:value={timeZone} />
				<span class="field-hint">Used for every date and countdown in the app.</span>
			</div>
			<button class="btn btn-wax btn-block" disabled={busy}>{busy ? 'Lighting the fire...' : 'Open the workshop'}</button>
		</form>
	</section>
</main>

<style>
	.setup {
		position: relative;
		z-index: 2;
		min-height: 100dvh;
		display: grid;
		place-items: center;
		padding: 24px 16px;
	}

	.card {
		width: 100%;
		max-width: 480px;
		padding: 30px 26px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.head {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 6px;
	}

	h1 {
		color: var(--pine-800);
		font-size: 1.9rem;
	}
</style>
