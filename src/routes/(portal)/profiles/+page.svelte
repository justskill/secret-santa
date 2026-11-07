<script lang="ts">
	import { enhance } from '$app/forms';
	import Ornament from '$lib/components/Ornament.svelte';
	import SantaFace from '$lib/components/SantaFace.svelte';

	let { data } = $props();
	const viewer = $derived(data.viewer!);
	const everyone = $derived([
		{ ...viewer.account, ...viewer.accountNeeds, badge: viewer.accountBadge, you: true },
		...viewer.wards.map((ward) => ({ ...ward, you: false }))
	]);
</script>

<svelte:head>
	<title>Who's shopping? | Secret Santa</title>
</svelte:head>

<main class="picker">
	<div class="head rise">
		<SantaFace size={104} />
		<h1>Who's shopping today?</h1>
		<p class="muted">Each person has their own draw, wish list, and mail.</p>
	</div>

	<div class="profiles">
		{#each everyone as person, index (person.id)}
			<form method="POST" action="?/switch" use:enhance class="rise" style:animation-delay="{index * 60}ms">
				<input type="hidden" name="person" value={person.id} />
				<button class="profile" class:current={person.id === viewer.profile.id}>
					<span class="art">
						<Ornament name={person.name} color={person.color} photo={person.photo} size={100} label={false} />
						{#if person.badge}<span class="badge count">{person.badge}</span>{/if}
					</span>
					<span class="name">{person.firstName}</span>
					<span class="who">{person.you ? 'You' : 'Kid profile'}</span>
					{#if person.drawReady}<span class="ready">Name ready!</span>{/if}
				</button>
			</form>
		{/each}
	</div>

	<div class="row foot">
		<a class="back" href="/">Back to {viewer.profile.firstName}'s home</a>
		<form method="POST" action="/logout">
			<button class="back signout">Sign out</button>
		</form>
	</div>
</main>

<style>
	.picker {
		position: relative;
		z-index: 2;
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 30px;
		padding: 30px 16px 60px;
	}

	.head {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 10px;
	}

	.profiles {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 16px;
		max-width: 720px;
	}

	.profile {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		width: 148px;
		padding: 18px 10px 14px;
		background: var(--frost-bg);
		border: 1.5px solid rgba(255, 255, 255, 0.16);
		border-radius: var(--radius-lg);
		cursor: pointer;
		color: var(--snow);
		transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), background 0.18s ease, border-color 0.18s ease;
	}

	.profile:hover,
	.profile:focus-visible {
		transform: translateY(-5px) rotate(-1deg);
		background: var(--frost-bg-hover);
		border-color: var(--candle-400);
	}

	.profile.current {
		border-color: var(--candle-500);
		box-shadow: var(--shadow-glow);
	}

	.art {
		position: relative;
		display: block;
	}

	.count {
		position: absolute;
		top: 16px;
		right: -2px;
	}

	.name {
		font-family: var(--font-display);
		font-variation-settings: 'SOFT' 100;
		font-size: 1.25rem;
		font-weight: 600;
		margin-top: 4px;
	}

	.who {
		font-size: 0.8rem;
		color: var(--mist);
		font-weight: 700;
	}

	.ready {
		margin-top: 6px;
		padding: 3px 10px;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 800;
		color: #3b2708;
		background: linear-gradient(170deg, var(--candle-200), var(--candle-500));
	}

	.foot {
		justify-content: center;
		gap: 22px;
	}

	.signout {
		background: none;
		border: 0;
		padding: 0;
		text-decoration: underline;
		cursor: pointer;
	}

	.back {
		color: var(--mist);
		font-weight: 700;
		font-size: 0.95rem;
	}
</style>
