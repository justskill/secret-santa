<script lang="ts">
	import { enhance } from '$app/forms';
	import SantaFace from '$lib/components/SantaFace.svelte';

	let { data, form } = $props();
	let busy = $state(false);
</script>

<svelte:head>
	<title>You're invited | Secret Santa</title>
</svelte:head>

<main class="invite">
	<section class="paper stitched card rise">
		<div class="head">
			<SantaFace size={84} />
			{#if data.valid}
				<p class="hand greet">Ho ho ho, {data.firstName}!</p>
				<h1>Welcome to the workshop</h1>
			{:else}
				<h1>This invite has melted</h1>
			{/if}
		</div>
		{#if data.valid}
			<p>Choose a password and you'll stay signed in for the whole season on this device.</p>
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
				<input type="hidden" name="username" autocomplete="username" value={data.username} />
				<div class="field">
					<label for="password">Choose a password</label>
					<input id="password" name="password" type="password" autocomplete="new-password" minlength={data.minLength} required />
					<span class="field-hint">At least {data.minLength} characters.</span>
				</div>
				<div class="field">
					<label for="confirm">Type it again</label>
					<input id="confirm" name="confirm" type="password" autocomplete="new-password" required />
				</div>
				<button class="btn btn-wax btn-block" disabled={busy}>{busy ? 'One moment...' : "I'm ready"}</button>
				{#if data.username}
					<p class="small muted-ink center">Your sign-in name is <strong>{data.username}</strong>.</p>
				{/if}
			</form>
		{:else}
			<p>This link has expired or has already been used. Ask your organizer for a new one.</p>
		{/if}
	</section>
</main>

<style>
	.invite {
		position: relative;
		z-index: 2;
		min-height: 100dvh;
		display: grid;
		place-items: center;
		padding: 24px 16px;
	}

	.card {
		width: 100%;
		max-width: 440px;
		padding: 30px 26px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.head {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 4px;
	}

	.greet {
		color: var(--cran-700);
		font-size: 1.9rem;
	}

	h1 {
		color: var(--pine-800);
		font-size: 1.7rem;
	}

	.center {
		text-align: center;
	}
</style>
