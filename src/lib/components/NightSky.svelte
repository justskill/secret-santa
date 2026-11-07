<script lang="ts">
	import Snowfall from './Snowfall.svelte';

	let { snow = true, intensity = 1 }: { snow?: boolean; intensity?: number } = $props();
</script>

<div class="sky" aria-hidden="true">
	<div class="stars"></div>
	<div class="stars far"></div>
	<div class="moon"></div>
	<svg class="hills" viewBox="0 0 1600 420" preserveAspectRatio="xMidYMax slice">
		<defs>
			<linearGradient id="hill-far" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0" stop-color="#1e3d5c" />
				<stop offset="1" stop-color="#132a44" />
			</linearGradient>
			<linearGradient id="hill-mid" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0" stop-color="#2c4f70" />
				<stop offset="1" stop-color="#16324c" />
			</linearGradient>
			<linearGradient id="hill-near" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0" stop-color="#c3d5e6" />
				<stop offset="0.5" stop-color="#7f9cb9" />
				<stop offset="1" stop-color="#2f4a66" />
			</linearGradient>
			<radialGradient id="window-glow">
				<stop offset="0" stop-color="#ffd98a" stop-opacity="0.9" />
				<stop offset="1" stop-color="#ffd98a" stop-opacity="0" />
			</radialGradient>
			<g id="pine">
				<path d="M0 0 L-14 26 L-7 26 L-20 50 L-10 50 L-26 80 L26 80 L10 50 L20 50 L7 26 L14 26 Z" fill="#0d2b24" />
				<path d="M0 0 L-6 11 L-1 9 L3 13 L6 11 Z M-9 28 L-14 37 L-6 34 L0 38 L8 34 L13 37 L8 28 L0 31 Z" fill="#dfeaf2" opacity="0.8" />
			</g>
		</defs>

		<path d="M0 250 C 200 170 340 210 520 180 C 720 146 900 220 1100 170 C 1280 128 1450 200 1600 160 L1600 420 L0 420 Z" fill="url(#hill-far)" />
		<g opacity="0.75">
			<use href="#pine" transform="translate(120 170) scale(0.55)" />
			<use href="#pine" transform="translate(170 180) scale(0.42)" />
			<use href="#pine" transform="translate(640 138) scale(0.5)" />
			<use href="#pine" transform="translate(690 148) scale(0.38)" />
			<use href="#pine" transform="translate(1180 122) scale(0.55)" />
			<use href="#pine" transform="translate(1240 134) scale(0.42)" />
			<use href="#pine" transform="translate(1480 124) scale(0.48)" />
		</g>
		<path d="M0 320 C 240 240 420 300 640 262 C 860 226 1040 306 1280 256 C 1420 228 1520 262 1600 246 L1600 420 L0 420 Z" fill="url(#hill-mid)" />
		<g>
			<use href="#pine" transform="translate(70 210) scale(1.05)" />
			<use href="#pine" transform="translate(150 232) scale(0.8)" />
			<use href="#pine" transform="translate(980 212) scale(1)" />
			<use href="#pine" transform="translate(1060 232) scale(0.75)" />
			<use href="#pine" transform="translate(1520 180) scale(1.15)" />
			<use href="#pine" transform="translate(1440 205) scale(0.85)" />
		</g>

		<!-- A little cabin with the lights on -->
		<g transform="translate(420 226)">
			<circle cx="46" cy="44" r="60" fill="url(#window-glow)" opacity="0.65" />
			<path d="M4 34 H88 V78 H4 Z" fill="#2c1c14" />
			<path d="M-8 36 L46 0 L100 36 Q46 24 -8 36 Z" fill="#eaf2f8" />
			<rect x="68" y="4" width="12" height="20" fill="#3a2a22" />
			<rect x="16" y="44" width="18" height="16" rx="2" fill="#ffd98a" />
			<rect x="58" y="44" width="18" height="16" rx="2" fill="#ffd98a" />
			<path d="M25 44 V60 M16 52 H34 M67 44 V60 M58 52 H76" stroke="#2c1c14" stroke-width="1.6" />
		</g>

		<path d="M0 372 C 300 310 520 372 800 344 C 1100 314 1320 382 1600 336 L1600 420 L0 420 Z" fill="url(#hill-near)" />
	</svg>
	<div class="vignette"></div>
</div>
{#if snow}
	<Snowfall {intensity} />
{/if}

<style>
	.sky {
		position: fixed;
		inset: 0;
		z-index: 0;
		overflow: hidden;
		background:
			radial-gradient(90% 60% at 80% 0%, rgba(58, 96, 142, 0.5), transparent 70%),
			radial-gradient(70% 50% at 10% 30%, rgba(28, 77, 64, 0.35), transparent 75%),
			linear-gradient(180deg, #081422 0%, #0c1e33 52%, #13304c 100%);
		pointer-events: none;
	}

	.stars {
		position: absolute;
		inset: 0 0 35% 0;
		background-image:
			radial-gradient(1.6px 1.6px at 12% 18%, #fff, transparent),
			radial-gradient(1.2px 1.2px at 27% 42%, #e7f2ff, transparent),
			radial-gradient(2px 2px at 41% 12%, #fff6da, transparent),
			radial-gradient(1.2px 1.2px at 55% 33%, #fff, transparent),
			radial-gradient(1.6px 1.6px at 68% 9%, #dcecff, transparent),
			radial-gradient(1.2px 1.2px at 74% 48%, #fff, transparent),
			radial-gradient(1.8px 1.8px at 89% 26%, #fff6da, transparent),
			radial-gradient(1.2px 1.2px at 94% 58%, #fff, transparent),
			radial-gradient(1.2px 1.2px at 6% 62%, #fff, transparent),
			radial-gradient(1.4px 1.4px at 35% 70%, #e7f2ff, transparent);
		animation: twinkle 5s ease-in-out infinite alternate;
	}

	.stars.far {
		background-image:
			radial-gradient(1px 1px at 18% 28%, #fff, transparent),
			radial-gradient(1px 1px at 33% 8%, #fff, transparent),
			radial-gradient(1px 1px at 47% 52%, #cfe3ff, transparent),
			radial-gradient(1px 1px at 61% 20%, #fff, transparent),
			radial-gradient(1px 1px at 82% 42%, #fff, transparent),
			radial-gradient(1px 1px at 22% 78%, #fff, transparent),
			radial-gradient(1px 1px at 52% 84%, #fff, transparent),
			radial-gradient(1px 1px at 96% 12%, #cfe3ff, transparent);
		animation-duration: 7s;
		animation-delay: -3s;
	}

	@keyframes twinkle {
		from {
			opacity: 0.55;
		}
		to {
			opacity: 1;
		}
	}

	.moon {
		position: absolute;
		top: 5%;
		right: 7%;
		width: clamp(56px, 9vw, 104px);
		aspect-ratio: 1;
		border-radius: 50%;
		background: radial-gradient(circle at 36% 34%, #fff9e6, #f6e7bb 62%, #e6d097);
		box-shadow: 0 0 50px 12px rgba(248, 232, 186, 0.35), 0 0 130px 40px rgba(248, 232, 186, 0.14);
	}

	.hills {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		width: 100%;
		height: 44vh;
		min-height: 240px;
		max-width: none;
	}

	.vignette {
		position: absolute;
		inset: 0;
		background: radial-gradient(120% 90% at 50% 40%, transparent 55%, rgba(3, 9, 17, 0.55));
	}
</style>
