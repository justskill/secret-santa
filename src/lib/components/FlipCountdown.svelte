<script lang="ts">
	import { onMount } from 'svelte';

	let {
		target,
		title,
		subtitle = '',
		dateLabel = '',
		size = 'large',
		tone = 'gold'
	}: {
		target: string;
		title: string;
		subtitle?: string;
		dateLabel?: string;
		size?: 'large' | 'small';
		tone?: 'gold' | 'wax';
	} = $props();

	// The server renders the static layout and the browser supplies the live numbers.
	let now = $state<number | null>(null);

	onMount(() => {
		now = Date.now();
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});

	const remaining = $derived(now === null ? null : Math.max(0, new Date(target).getTime() - now));
	const passed = $derived(remaining === 0);
	const parts = $derived.by(() => {
		if (remaining === null) return { days: '--', hours: '--', minutes: '--', seconds: '--' };
		const total = Math.floor(remaining / 1000);
		return {
			days: String(Math.floor(total / 86400)),
			hours: String(Math.floor((total % 86400) / 3600)).padStart(2, '0'),
			minutes: String(Math.floor((total % 3600) / 60)).padStart(2, '0'),
			seconds: String(total % 60).padStart(2, '0')
		};
	});
	const units = $derived([
		{ label: parts.days === '1' ? 'day' : 'days', value: parts.days },
		{ label: 'hours', value: parts.hours },
		{ label: 'mins', value: parts.minutes },
		{ label: 'secs', value: parts.seconds }
	]);
</script>

<section class="countdown {size} {tone}" aria-label="{title}{dateLabel ? `, ${dateLabel}` : ''}">
	<header>
		<h3>{title}</h3>
		{#if subtitle}<p class="subtitle">{subtitle}</p>{/if}
	</header>
	{#if passed}
		<p class="arrived hand">It's here!</p>
	{:else}
		<div class="tiles" role="timer">
			{#each units as unit (unit.label)}
				<div class="unit">
					<div class="tile">
						{#key unit.value}
							<span class="digit">{unit.value}</span>
						{/key}
					</div>
					<span class="label">{unit.label}</span>
				</div>
			{/each}
		</div>
	{/if}
	{#if dateLabel}<p class="date">{dateLabel}</p>{/if}
</section>

<style>
	.countdown {
		position: relative;
		border-radius: var(--radius);
		padding: 18px 16px 16px;
		text-align: center;
		color: var(--snow);
		overflow: hidden;
		box-shadow: var(--shadow-card);
		background: linear-gradient(165deg, var(--pine-700), var(--pine-900));
		isolation: isolate;
	}

	.countdown.wax {
		background: linear-gradient(165deg, var(--cran-700), #4f0e1c);
	}

	.countdown::before {
		content: '';
		position: absolute;
		inset: 6px;
		border-radius: calc(var(--radius) - 6px);
		border: 1.5px solid rgba(240, 195, 106, 0.35);
		pointer-events: none;
		z-index: -1;
	}

	h3 {
		color: var(--candle-200);
		font-size: 1.15rem;
	}

	.large h3 {
		font-size: clamp(1.25rem, 3.4vw, 1.6rem);
	}

	.subtitle {
		font-size: 0.9rem;
		color: rgba(244, 249, 255, 0.78);
		margin-top: 2px;
	}

	.tiles {
		display: flex;
		justify-content: center;
		gap: clamp(6px, 1.8vw, 12px);
		margin-top: 12px;
	}

	.unit {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 5px;
		flex: 0 1 auto;
		min-width: 0;
	}

	.tile {
		position: relative;
		min-width: 2.1em;
		height: 1.6em;
		padding: 0 0.22em;
		display: grid;
		place-items: center;
		font-family: var(--font-display);
		font-variation-settings: 'SOFT' 100;
		font-weight: 700;
		line-height: 1;
		color: var(--candle-400);
		background: linear-gradient(180deg, #16283b 0 49.5%, #0e1c2c 50.5% 100%);
		border-radius: 10px;
		box-shadow: 0 2px 0 rgba(255, 255, 255, 0.08) inset, 0 6px 12px -4px rgba(0, 0, 0, 0.7);
		perspective: 200px;
		overflow: hidden;
		font-variant-numeric: tabular-nums;
	}

	.tile::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: calc(50% - 0.5px);
		height: 1px;
		background: rgba(0, 0, 0, 0.6);
	}

	.large .tile {
		font-size: clamp(1.9rem, 7.4vw, 3.1rem);
	}

	.small .tile {
		font-size: clamp(1.45rem, 5.4vw, 1.9rem);
	}

	.digit {
		display: block;
		animation: flip 0.32s cubic-bezier(0.3, 0.8, 0.4, 1);
		transform-origin: center;
		backface-visibility: hidden;
	}

	@keyframes flip {
		from {
			transform: rotateX(-82deg);
			opacity: 0.2;
		}
		to {
			transform: rotateX(0);
			opacity: 1;
		}
	}

	.label {
		font-size: 0.68rem;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: rgba(244, 249, 255, 0.75);
	}

	.date {
		margin-top: 10px;
		font-size: 0.88rem;
		color: rgba(244, 249, 255, 0.82);
	}

	.arrived {
		margin-top: 8px;
		color: var(--candle-400);
		font-size: 2.2rem;
	}
</style>
