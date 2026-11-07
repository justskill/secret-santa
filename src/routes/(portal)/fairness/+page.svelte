<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import WaxSeal from '$lib/components/WaxSeal.svelte';
	import { formatDateTime } from '$lib/time';

	let { data } = $props();

	const arrangements = $derived(data.commitments?.at(-1)?.arrangements ?? null);
</script>

<svelte:head>
	<title>How the draw stays fair | Secret Santa</title>
</svelte:head>

<main class="page narrow stack">
	<div class="page-title">
		<h1>How the draw stays fair</h1>
		<p>No hats, no folded paper, no recounts, and nobody peeking.</p>
	</div>

	{#if !data.hasSeason}
		<section class="paper"><p class="empty">The workshop isn't open yet.</p></section>
	{:else}
		{#if data.houseRules || data.spendLimit}
			<section class="paper stitched rise">
				<h2>This year's house rules</h2>
				{#if data.spendLimit}<p class="limit">Spending limit: <strong>{data.spendLimit}</strong></p>{/if}
				{#if data.houseRules}
					<ul class="rules">
						{#each data.houseRules.split('\n').filter((line) => line.trim()) as line}
							<li>{line}</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}

		<section class="paper rise">
			<h2>The rules Santa follows</h2>
			<ul class="checks">
				<li><Icon name="check" size={18} /> Nobody draws themselves.</li>
				{#if data.rules?.guardian}<li><Icon name="check" size={18} /> Kids don't draw their parents, and parents don't draw their kids.</li>{/if}
				{#if data.rules?.household}<li><Icon name="check" size={18} /> Nobody draws someone from their own household.</li>{/if}
				{#if data.rules?.noRepeat}<li><Icon name="check" size={18} /> Nobody draws the same person as last year.</li>{/if}
				{#if data.rules?.noReciprocal}<li><Icon name="check" size={18} /> Two people can't draw each other.</li>{/if}
				{#each data.rules?.custom ?? [] as rule (rule.id)}
					<li><Icon name="check" size={18} /> {rule.bothWays ? `${rule.giver} and ${rule.receiver} can't draw each other.` : `${rule.giver} can't draw ${rule.receiver}.`}</li>
				{/each}
			</ul>
		</section>

		<section class="paper rise">
			<h2>How your name was picked</h2>
			<div class="prose">
				<p>A computer draws everyone's names at once, using a secure random number generator. Among all the arrangements that follow the rules, each one is equally likely.</p>
				{#if arrangements}
					<p class="odds">Santa chose from <strong>{arrangements.toLocaleString()}</strong> possible {arrangements === 1 ? 'arrangement' : 'arrangements'}.</p>
				{/if}
				<p>When you press and hold the box, you are opening a name that was already sealed. The spinning names are just for fun, but the result is real. Because every name is chosen at the start, nobody can run out of options by drawing last.</p>
			</div>
		</section>

		<section class="paper rise">
			<h2>Who can see what</h2>
			<ul class="checks">
				<li><Icon name="shield" size={18} /> <span><strong>Santa can't tell you who drew you.</strong> His tools can only reach your own draw, so that information never reaches him.</span></li>
				<li><Icon name="shield" size={18} /> <span><strong>The organizer's screens never show the pairs,</strong> or anyone's chats with Santa. The pairs are encrypted in the database too.</span></li>
				<li><Icon name="shield" size={18} /> <span><strong>Your list is private.</strong> Only you, your parents if you're a kid, and whoever drew you can see it.</span></li>
				<li><Icon name="shield" size={18} /> <span><strong>Questions stay anonymous.</strong> Santa rewords them to hide who wrote them, and delays delivery so the timing doesn't give anyone away.</span></li>
			</ul>
			<div class="honest">
				<p class="small">
					An honest note: whoever runs the server owns the machine and the encryption key, so software alone can't make it impossible for them to look.
					These protections prevent accidental spoilers and make in-app peeking visible to everyone.
				</p>
			</div>
		</section>

		<section class="paper seal-section rise">
			<div class="row seal-head">
				<WaxSeal size={60} />
				<h2>Santa's seal</h2>
			</div>
			{#if data.commitments?.length}
				<p>
					When the names were sealed, Santa published this fingerprint of the result. After the big reveal, anyone can check that the
					revealed list matches it, which proves the names weren't changed along the way.
				</p>
				<ul class="prints">
					{#each data.commitments as commitment (commitment.version)}
						<li>
							<code>{commitment.hash}</code>
							<span class="small muted">{commitment.reason} {formatDateTime(commitment.created_at, data.timeZone)}</span>
						</li>
					{/each}
				</ul>
				{#if data.status === 'revealed' || data.status === 'archived'}
					<a class="btn btn-gold" href="/reveal">Check it on the reveal page</a>
				{/if}
			{:else}
				<p>The names haven't been sealed yet. Santa will publish a fingerprint here as soon as they are.</p>
			{/if}
			{#if data.emergencyReveals}
				<p class="alert alert-warn">
					The organizer has used the emergency reveal {data.emergencyReveals} {data.emergencyReveals === 1 ? 'time' : 'times'} this season.
				</p>
			{:else if data.commitments?.length}
				<p class="alert alert-good">The emergency reveal has not been used.</p>
			{/if}
		</section>
	{/if}
</main>

<style>
	.limit {
		margin-top: 8px;
	}

	.rules {
		margin: 8px 0 0;
		padding-left: 20px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.checks {
		list-style: none;
		margin: 10px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.checks li {
		display: flex;
		gap: 10px;
		align-items: flex-start;
	}

	.checks :global(svg) {
		color: var(--pine-500);
		margin-top: 4px;
	}

	.prose {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 8px;
	}

	.odds {
		padding: 10px 14px;
		border-radius: 12px;
		background: var(--paper-200);
	}

	.honest {
		margin-top: 14px;
		padding: 12px 14px;
		border-radius: 12px;
		background: var(--paper-200);
	}

	.seal-section {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.prints {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.prints code {
		display: block;
		font-size: 0.82rem;
		word-break: break-all;
		padding: 8px 10px;
		border-radius: 8px;
		background: var(--night-900);
		color: var(--candle-400);
	}

	.prints span {
		display: block;
		margin-top: 3px;
	}
</style>
