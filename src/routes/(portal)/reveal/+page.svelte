<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import Ornament from '$lib/components/Ornament.svelte';
	import SantaFace from '$lib/components/SantaFace.svelte';
	import WaxSeal from '$lib/components/WaxSeal.svelte';

	let { data } = $props();

	let checks = $state<Record<number, 'match' | 'mismatch' | 'unavailable'>>({});
	let checking = $state(false);
	let listMatches = $state(true);
	const allChecked = $derived(data.published && data.proofs.every((proof) => checks[proof.version]));
	const allGood = $derived(data.published && data.proofs.every((proof) => checks[proof.version] === 'match'));

	/** The check runs in this browser, so nobody has to take the server's word for it. */
	async function verify() {
		if (!data.published) return;
		checking = true;
		for (const proof of data.proofs) {
			if (!crypto?.subtle) {
				checks[proof.version] = 'unavailable';
				continue;
			}
			const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(proof.canonical));
			const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
			checks[proof.version] = hex === proof.hash ? 'match' : 'mismatch';
		}
		// The fingerprint only proves the sealed text, so also compare that text with the list on screen.
		const latest = data.proofs.at(-1);
		if (latest) {
			const sealed = new Map((JSON.parse(latest.canonical) as { pairs: [number, number][] }).pairs);
			listMatches = sealed.size === data.pairs.length && data.pairs.every((pair) => sealed.get(pair.giver?.id ?? -1) === pair.receiver?.id);
		}
		checking = false;
	}
</script>

<svelte:head>
	<title>The big reveal | Secret Santa</title>
</svelte:head>

<main class="page stack">
	{#if !data.published}
		<section class="paper stitched center rise">
			<SantaFace size={90} />
			<h1>Not yet!</h1>
			<p>The sealed list stays closed until after the gifts are opened.</p>
			<a class="btn btn-gold" href="/">Back home</a>
		</section>
	{:else}
		<header class="hero rise">
			<WaxSeal size={84} />
			<p class="eyebrow">{data.seasonName}</p>
			<h1>The big reveal</h1>
			<p class="hand line">Ho ho ho! Now it can be told.</p>
		</header>

		<section class="chain">
			{#each data.pairs as pair, index}
				<div class="pair paper rise" style:animation-delay="{Math.min(index * 70, 700)}ms">
					<div class="person">
						{#if pair.giver}<Ornament name={pair.giver.name} color={pair.giver.color} photo={pair.giver.photo} size={62} label={false} />{/if}
						<strong>{pair.giver?.firstName}</strong>
					</div>
					<div class="arrow"><span class="hand">had</span><Icon name="gift" size={22} /></div>
					<div class="person">
						{#if pair.receiver}<Ornament name={pair.receiver.name} color={pair.receiver.color} photo={pair.receiver.photo} size={62} label={false} />{/if}
						<strong>{pair.receiver?.firstName}</strong>
					</div>
				</div>
			{/each}
		</section>

		<div class="grid-2">
			<section class="paper stitched">
				<h2>The off-list ledger</h2>
				{#if data.stats.asked || data.stats.boughtWithoutAsking}
					<div class="numbers">
						<div><strong>{data.stats.asked}</strong><span>asked first</span></div>
						<div><strong>{data.stats.approved}</strong><span>approved</span></div>
						<div><strong>{data.stats.declined}</strong><span>declined</span></div>
						<div class:naughty={data.stats.boughtWithoutAsking}><strong>{data.stats.boughtWithoutAsking}</strong><span>didn't ask</span></div>
					</div>
				{:else}
					<p class="muted-ink">Nobody bought anything off-list this year. A Christmas miracle!</p>
				{/if}
				{#if data.niceList.length}
					<hr class="divider" />
					<p class="eyebrow">The Nice List: they asked first</p>
					<div class="nice">
						{#each data.niceList as person}
							{#if person}
								<span class="nice-person">
									<Ornament name={person.name} color={person.color} photo={person.photo} size={36} label={false} />
									{person.firstName}
								</span>
							{/if}
						{/each}
					</div>
				{/if}
			</section>

			<section class="paper">
				<h2>Check Santa's seal</h2>
				<p class="small">This recalculates the fingerprint in your browser and compares it to the one published when the names were sealed.</p>
				<button class="btn btn-gold verify" onclick={verify} disabled={checking}>
					<Icon name="shield" size={18} /> {checking ? 'Checking...' : 'Check the seal'}
				</button>
				{#if allChecked}
					{#if allGood && listMatches}
						<p class="alert alert-good" role="status">The seal is intact, and it matches the list above. Compare the fingerprint with the one from the fairness page to be sure.</p>
					{:else if data.proofs.some((proof) => checks[proof.version] === 'unavailable')}
						<p class="alert alert-warn" role="status">This browser can't run the check here. Secure connections (https) are required.</p>
					{:else}
						<p class="alert alert-bad" role="status">The seal doesn't match. Something changed after sealing!</p>
					{/if}
				{/if}
				<details>
					<summary>See the proof</summary>
					{#each data.proofs as proof (proof.version)}
						<div class="proof">
							<p class="small"><strong>Version {proof.version}.</strong> {proof.reason}</p>
							<p class="small muted-ink">Fingerprint:</p>
							<code>{proof.hash}</code>
							<p class="small muted-ink">Sealed text (numbers are people):</p>
							<code>{proof.canonical}</code>
							<p class="small muted-ink">
								{Object.entries(proof.names).map(([id, name]) => `${id} = ${name}`).join(', ')}
							</p>
						</div>
					{/each}
				</details>
			</section>
		</div>
	{/if}
</main>

<style>
	.center {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 12px;
		padding: 36px 24px;
		max-width: 500px;
		margin: 6vh auto 0;
	}

	.center h1 {
		color: var(--pine-800);
	}

	.hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 4px;
	}

	.line {
		color: var(--candle-400);
		font-size: 2rem;
	}

	.chain {
		display: grid;
		gap: 12px;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
	}

	.pair {
		display: flex;
		align-items: center;
		justify-content: space-around;
		gap: 8px;
		padding: 14px;
	}

	.person {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		min-width: 84px;
		color: var(--ink-900);
	}

	.arrow {
		display: flex;
		flex-direction: column;
		align-items: center;
		color: var(--cran-600);
	}

	.numbers {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 8px;
		margin-top: 12px;
		text-align: center;
	}

	.numbers strong {
		display: block;
		font-family: var(--font-display);
		font-size: 2rem;
		line-height: 1;
		color: var(--pine-700);
	}

	.numbers span {
		font-size: 0.8rem;
		color: var(--ink-500);
		line-height: 1.2;
		display: block;
		margin-top: 4px;
	}

	.numbers .naughty strong {
		color: var(--cran-600);
	}

	.nice {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-top: 8px;
	}

	.nice-person {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-weight: 800;
	}

	.verify {
		margin: 12px 0;
	}

	details {
		margin-top: 12px;
	}

	summary {
		cursor: pointer;
		font-weight: 800;
		color: var(--cran-700);
	}

	.proof {
		margin-top: 12px;
	}

	.proof code {
		display: block;
		font-size: 0.74rem;
		word-break: break-all;
		padding: 8px 10px;
		margin: 4px 0 8px;
		border-radius: 8px;
		background: var(--night-900);
		color: var(--candle-400);
	}
</style>
