<script lang="ts">
	import { enhance } from '$app/forms';
	import SantaFace from '$lib/components/SantaFace.svelte';

	let { data, form } = $props();
	let busy = $state(false);
</script>

<svelte:head>
	<title>Sign in | Secret Santa</title>
</svelte:head>

<main class="login">
	<header class="brand rise">
		<SantaFace size={132} />
		<p class="hand tagline">Ho ho ho! Who goes there?</p>
		<h1>{data.familyName}<br /><span>Secret Santa</span></h1>
	</header>

	<section class="paper stitched card rise">
		{#if data.needsSetup}
			<h2>The workshop isn't open yet</h2>
			<p class="muted-ink">
				This server has not been set up. The setup link is printed in the server's log when it starts.
			</p>
		{:else}
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
					<label for="username">Your name</label>
					<input id="username" name="username" type="text" autocomplete="username" autocapitalize="none" value={form?.username ?? ''} required />
				</div>
				<div class="field">
					<label for="password">Password</label>
					<input id="password" name="password" type="password" autocomplete="current-password" required />
				</div>
				<button class="btn btn-wax btn-block" disabled={busy}>{busy ? 'Checking the list...' : 'Come on in'}</button>
				<p class="small muted-ink center">New here, or forgot your password? Ask for a fresh invite link.</p>
			</form>
		{/if}
	</section>

	{#if data.demoLogins}
		<section class="frost demo rise">
			<h2>Demo family</h2>
			<p class="small">This is demo mode with a made-up family. All passwords are <strong>{data.demoPassword}</strong>.</p>
			<table>
				<tbody>
					{#each data.demoLogins as login}
						<tr>
							<td><code>{login.username}</code></td>
							<td>{login.note}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{/if}
</main>

<style>
	.login {
		position: relative;
		z-index: 2;
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 20px;
		padding: 34px 16px 60px;
	}

	.brand {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 6px;
	}

	.tagline {
		color: var(--candle-400);
		font-size: 1.8rem;
	}

	h1 {
		font-size: clamp(1.15rem, 3.4vw, 1.4rem);
		font-weight: 500;
		color: var(--mist);
		line-height: 1.25;
	}

	h1 span {
		display: block;
		font-size: clamp(2.6rem, 9vw, 3.8rem);
		font-weight: 700;
		color: var(--snow);
		line-height: 1.05;
		text-shadow: 0 3px 22px rgba(240, 195, 106, 0.35);
	}

	.card {
		width: 100%;
		max-width: 420px;
		padding: 26px;
		animation-delay: 0.08s;
	}

	.center {
		text-align: center;
	}

	.demo {
		width: 100%;
		max-width: 420px;
		animation-delay: 0.16s;
	}

	.demo h2 {
		font-size: 1.15rem;
		color: var(--candle-400);
		margin-bottom: 4px;
	}

	.demo table {
		width: 100%;
		margin-top: 8px;
		font-size: 0.92rem;
		border-collapse: collapse;
	}

	.demo td {
		padding: 3px 8px 3px 0;
		vertical-align: top;
	}

	.demo code {
		font-weight: 800;
		color: var(--candle-200);
	}
</style>
