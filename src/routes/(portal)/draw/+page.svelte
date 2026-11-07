<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import DrawCeremony from '$lib/components/DrawCeremony.svelte';
	import NightSky from '$lib/components/NightSky.svelte';
	import Ornament from '$lib/components/Ornament.svelte';
	import PortalNav from '$lib/components/PortalNav.svelte';
	import SantaFace from '$lib/components/SantaFace.svelte';
	import WaxSeal from '$lib/components/WaxSeal.svelte';
	import { formatDateTime } from '$lib/time';

	let { data } = $props();
	let replaying = $state(false);
	let justDrew = $state(false);
</script>

<svelte:head>
	<title>The draw | Secret Santa</title>
</svelte:head>

{#if (data.state === 'ready' || replaying || justDrew) && (data.state === 'ready' || data.state === 'revealed')}
	<DrawCeremony
		profile={data.profile}
		helping={data.helping}
		reel={data.reel}
		recipient={data.recipient}
		replay={replaying}
		onfinish={() => {
			justDrew = true;
			void invalidateAll();
		}}
	/>
{:else}
	<NightSky />
	<PortalNav />
	<main class="page narrow center-page">
		<section class="paper stitched panel rise">
			{#if data.state === 'revealed' && data.recipient}
				<div class="seal"><WaxSeal size={70} /></div>
				<p class="eyebrow">{data.helping ? `${data.profile.firstName} is Secret Santa for` : 'You are Secret Santa for'}</p>
				<Ornament name={data.recipient.name} color={data.recipient.color} photo={data.recipient.photo} size={108} label={false} />
				<h1 class="winner">{data.recipient.name}</h1>
				<p class="hand">Shh! Keep it secret.</p>
				<div class="row actions">
					<a class="btn btn-wax" href="/my-person">See {data.recipient.firstName}'s wish list</a>
					<button class="btn btn-ghost" onclick={() => (replaying = true)}>Replay the reveal</button>
				</div>
			{:else if data.state === 'not_open'}
				<SantaFace size={90} />
				<h1>Not quite yet</h1>
				<p>The names are sealed. Names can be opened on {data.opensAt ? formatDateTime(data.opensAt, data.timeZone) : 'a day your organizer picks'}.</p>
				<a class="btn btn-gold" href="/">Back home</a>
			{:else if data.state === 'not_in_draw'}
				<SantaFace size={90} />
				<h1>Sitting this one out</h1>
				<p>{data.helping ? `${data.profile.firstName} isn't` : "You aren't"} part of this year's draw. Talk to your organizer if that's a mistake.</p>
				<a class="btn btn-gold" href="/">Back home</a>
			{:else}
				<SantaFace size={90} />
				<h1>The elves are still wrapping</h1>
				<p>Santa hasn't sealed the names yet. You'll get a notice here as soon as your name is ready to open.</p>
				<div class="row actions">
					<a class="btn btn-wax" href="/my-list">Work on {data.helping ? `${data.profile.firstName}'s` : 'your'} wish list</a>
					<a class="btn btn-ghost" href="/fairness">How the draw works</a>
				</div>
			{/if}
		</section>
	</main>
{/if}

<style>
	.center-page {
		min-height: 80dvh;
		display: grid;
		place-items: center;
	}

	.panel {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 12px;
		padding: 38px 24px 28px;
		width: 100%;
		max-width: 500px;
	}

	.panel h1 {
		color: var(--pine-800);
	}

	.panel h1.winner {
		color: var(--cran-700);
	}

	.panel .hand {
		color: var(--ink-700);
	}

	.seal {
		position: absolute;
		top: -30px;
	}

	.actions {
		justify-content: center;
		margin-top: 6px;
	}
</style>
