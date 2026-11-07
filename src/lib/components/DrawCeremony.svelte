<script lang="ts">
	import { onMount, tick as nextTick } from 'svelte';
	import { fanfare, jingle, ribbonWhoosh, setSoundEnabled, soundEnabled, tick } from '$lib/client/sound';
	import type { PublicPerson } from '$lib/server/people';
	import Icon from './Icon.svelte';
	import NightSky from './NightSky.svelte';
	import Ornament from './Ornament.svelte';
	import SantaFace from './SantaFace.svelte';
	import WaxSeal from './WaxSeal.svelte';

	let {
		profile,
		helping,
		reel,
		recipient: initialRecipient,
		replay = false,
		onfinish
	}: {
		profile: PublicPerson;
		helping: boolean;
		reel: PublicPerson[];
		recipient: PublicPerson | null;
		replay?: boolean;
		onfinish?: (person: PublicPerson) => void;
	} = $props();

	type Stage = 'waiting' | 'holding' | 'opening' | 'spinning' | 'landed';

	const HOLD_MS = 2200;
	const SPIN_MS = 5200;
	const TILE = 132;

	let stage = $state<Stage>('waiting');
	let progress = $state(0);
	let recipient = $state<PublicPerson | null>(null);
	let errorMessage = $state('');
	let sound = $state(false);
	let reducedMotion = false;

	let holdStart = 0;
	let holdFrame = 0;
	let lastJingle = 0;
	let spinFrame = 0;
	let track = $state<HTMLDivElement>();
	let burst = $state<HTMLCanvasElement>();
	let reelPeople = $state<PublicPerson[]>([]);
	let liftFrame = 0;

	onMount(() => {
		sound = soundEnabled();
		reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
		return () => {
			cancelAnimationFrame(holdFrame);
			cancelAnimationFrame(spinFrame);
			cancelAnimationFrame(liftFrame);
		};
	});

	function toggleSound() {
		sound = !sound;
		setSoundEnabled(sound);
		if (sound) jingle(0.2);
	}

	/* ---- Hold to untie ---- */

	function beginHold(event: Event) {
		if (stage !== 'waiting') return;
		event.preventDefault();
		errorMessage = '';
		stage = 'holding';
		holdStart = performance.now();
		lastJingle = 0;
		holdFrame = requestAnimationFrame(holdLoop);
	}

	function holdLoop(now: number) {
		if (stage !== 'holding') return;
		progress = Math.min(1, (now - holdStart) / HOLD_MS);
		if (now - lastJingle > 340 - progress * 220) {
			jingle(progress);
			lastJingle = now;
		}
		if (progress >= 1) {
			void finishHold();
			return;
		}
		holdFrame = requestAnimationFrame(holdLoop);
	}

	function endHold() {
		if (stage !== 'holding') return;
		cancelAnimationFrame(holdFrame);
		stage = 'waiting';
		// The ribbon springs back so it is clear the box has to be held.
		const start = progress;
		const began = performance.now();
		const settle = (now: number) => {
			const t = Math.min(1, (now - began) / 260);
			progress = start * (1 - t);
			if (t < 1 && stage === 'waiting') liftFrame = requestAnimationFrame(settle);
		};
		liftFrame = requestAnimationFrame(settle);
	}

	function onKey(event: KeyboardEvent) {
		if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) beginHold(event);
	}

	function onKeyUp(event: KeyboardEvent) {
		if (event.key === ' ' || event.key === 'Enter') endHold();
	}

	async function finishHold() {
		stage = 'opening';
		ribbonWhoosh();

		// On a replay the name is already known. Otherwise this is when it leaves the server.
		if (replay && initialRecipient) {
			recipient = initialRecipient;
		} else {
			try {
				const response = await fetch('/api/draw/reveal', { method: 'POST' });
				if (!response.ok) throw new Error(response.status === 409 ? 'Your name is not ready to open yet.' : 'Santa dropped the name!');
				recipient = ((await response.json()) as { recipient: PublicPerson }).recipient;
			} catch (err) {
				errorMessage = err instanceof Error ? err.message : 'Santa dropped the name!';
				stage = 'waiting';
				progress = 0;
				return;
			}
		}

		await new Promise((resolve) => setTimeout(resolve, reducedMotion ? 80 : 900));
		await spin();
	}

	/* ---- The reel ---- */

	function buildReel(winner: PublicPerson): { people: PublicPerson[]; stopIndex: number } {
		const pool = reel.length ? reel : [winner];
		const people: PublicPerson[] = [];
		// Enough tiles to fill several seconds of spinning, with no two neighbours the same.
		for (let lap = 0; lap < 7; lap++) {
			const shuffled = [...pool].sort(() => Math.random() - 0.5);
			if (people.at(-1)?.id === shuffled[0].id) shuffled.push(shuffled.shift()!);
			people.push(...shuffled);
		}
		const stopIndex = people.length;
		// The winner sits past the last lap, with a few extra tiles after it to fill the window.
		const tail = pool.filter((p) => p.id !== winner.id).slice(0, 4);
		people.push(winner, ...tail);
		return { people, stopIndex };
	}

	async function spin() {
		if (!recipient) return;
		const { people, stopIndex } = buildReel(recipient);
		reelPeople = people;
		stage = 'spinning';
		await nextTick();

		if (reducedMotion || !track) {
			land();
			return;
		}

		const windowHeight = track.parentElement?.clientHeight ?? TILE;
		const startY = 0;
		const endY = -(stopIndex * TILE) + (windowHeight - TILE) / 2;
		const began = performance.now();
		let lastIndex = -1;

		// Ease out strongly, so the last few names crawl past and the tension builds.
		const ease = (t: number) => 1 - Math.pow(1 - t, 4.4);

		const step = (now: number) => {
			const t = Math.min(1, (now - began) / SPIN_MS);
			const y = startY + (endY - startY) * ease(t);
			if (track) track.style.transform = `translate3d(0, ${y}px, 0)`;
			const index = Math.round(-y / TILE);
			if (index !== lastIndex) {
				lastIndex = index;
				tick();
			}
			if (t < 1) {
				spinFrame = requestAnimationFrame(step);
			} else {
				land();
			}
		};
		spinFrame = requestAnimationFrame(step);
	}

	async function land() {
		stage = 'landed';
		fanfare();
		await nextTick();
		runBurst();
		if (recipient) onfinish?.(recipient);
	}

	/* ---- Confetti of snow, stars, and gold ---- */

	function runBurst() {
		if (reducedMotion || !burst) return;
		const canvas = burst;
		const context = canvas.getContext('2d');
		if (!context) return;
		const ctx: CanvasRenderingContext2D = context;
		const ratio = Math.min(devicePixelRatio || 1, 2);
		const width = innerWidth;
		const height = innerHeight;
		canvas.width = width * ratio;
		canvas.height = height * ratio;
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

		const COLORS = ['#f0c36a', '#e3ab45', '#fff8e8', '#ffffff', '#d13a55', '#7cc4a8'];
		const pieces = Array.from({ length: 170 }, (_, index) => {
			const angle = Math.random() * Math.PI * 2;
			const speed = 180 + Math.random() * 620;
			return {
				x: width / 2,
				y: height * 0.42,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed - 170,
				size: 3 + Math.random() * 6,
				spin: Math.random() * 8 - 4,
				rotation: Math.random() * Math.PI,
				color: COLORS[index % COLORS.length],
				star: index % 5 === 0,
				life: 1.7 + Math.random() * 1.5
			};
		});

		const drawStar = (x: number, y: number, r: number, rotation: number) => {
			ctx.save();
			ctx.translate(x, y);
			ctx.rotate(rotation);
			ctx.beginPath();
			for (let i = 0; i < 10; i++) {
				const radius = i % 2 ? r * 0.45 : r;
				const a = (i * Math.PI) / 5;
				ctx.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
			}
			ctx.closePath();
			ctx.fill();
			ctx.restore();
		};

		let last = performance.now();
		let elapsed = 0;
		const frame = (now: number) => {
			const dt = Math.min((now - last) / 1000, 0.05);
			last = now;
			elapsed += dt;
			ctx.clearRect(0, 0, width, height);
			for (const piece of pieces) {
				if (elapsed > piece.life) continue;
				piece.vy += 520 * dt;
				piece.vx *= 1 - 0.9 * dt;
				piece.vy *= 1 - 0.32 * dt;
				piece.x += piece.vx * dt;
				piece.y += piece.vy * dt;
				piece.rotation += piece.spin * dt;
				ctx.globalAlpha = Math.max(0, Math.min(1, (piece.life - elapsed) * 1.6));
				ctx.fillStyle = piece.color;
				if (piece.star) {
					drawStar(piece.x, piece.y, piece.size * 1.5, piece.rotation);
				} else {
					ctx.beginPath();
					ctx.arc(piece.x, piece.y, piece.size * 0.6, 0, Math.PI * 2);
					ctx.fill();
				}
			}
			if (elapsed < 3.4) {
				liftFrame = requestAnimationFrame(frame);
			} else {
				ctx.clearRect(0, 0, width, height);
			}
		};
		liftFrame = requestAnimationFrame(frame);
	}

	const lidLift = $derived(stage === 'opening' || stage === 'spinning' || stage === 'landed');
	const showGift = $derived(stage === 'waiting' || stage === 'holding' || stage === 'opening');
	const shake = $derived(stage === 'holding' ? progress : 0);
	const RING = 2 * Math.PI * 92;
</script>

<NightSky intensity={stage === 'landed' ? 1.6 : 1} />

<div class="scene stage-{stage}" style:--shake={shake}>
	<div class="dim" aria-hidden="true"></div>
	<div class="spotlight" aria-hidden="true"></div>
	<canvas bind:this={burst} class="burst" aria-hidden="true"></canvas>

	<button class="sound" onclick={toggleSound} aria-pressed={sound} aria-label={sound ? 'Turn sound off' : 'Turn sound on'}>
		<Icon name={sound ? 'sound' : 'mute'} size={20} />
		<span>{sound ? 'Sound on' : 'Sound off'}</span>
	</button>

	{#if showGift}
		<div class="intro">
			{#if stage === 'waiting' || stage === 'holding'}
				<p class="eyebrow">{replay ? 'Once more, for fun' : helping ? `A name for ${profile.firstName} is sealed inside` : 'Your name is sealed inside'}</p>
				<h1>{helping ? `It's ${profile.firstName}'s turn` : `It's time, ${profile.firstName}`}</h1>
				<p class="hint hand" aria-live="polite">
					{#if stage === 'holding'}
						{progress < 0.5 ? 'Keep holding...' : progress < 0.85 ? 'The ribbon is slipping...' : 'Almost!'}
					{:else if helping}
						Open this one together with {profile.firstName}.
					{:else}
						Press and hold the box to untie the ribbon.
					{/if}
				</p>
			{/if}
		</div>

		<div class="gift-wrap" class:open={lidLift}>
			<button
				class="gift"
				aria-label="Press and hold to open the name"
				disabled={stage === 'opening'}
				onpointerdown={beginHold}
				onpointerup={endHold}
				onpointerleave={endHold}
				onpointercancel={endHold}
				onkeydown={onKey}
				onkeyup={onKeyUp}
				oncontextmenu={(event) => event.preventDefault()}
			>
				<svg class="ring" viewBox="0 0 200 200" aria-hidden="true">
					<circle cx="100" cy="100" r="92" class="ring-track" />
					<circle
						cx="100"
						cy="100"
						r="92"
						class="ring-fill"
						stroke-dasharray={RING}
						stroke-dashoffset={RING * (1 - progress)}
						transform="rotate(-90 100 100)"
					/>
				</svg>

				<svg class="box" viewBox="0 0 240 240" aria-hidden="true">
					<defs>
						<linearGradient id="box-side" x1="0" y1="0" x2="1" y2="1">
							<stop offset="0" stop-color="#c22c48" />
							<stop offset="1" stop-color="#7d1528" />
						</linearGradient>
						<linearGradient id="box-lid" x1="0" y1="0" x2="1" y2="1">
							<stop offset="0" stop-color="#df4a65" />
							<stop offset="1" stop-color="#9c1c33" />
						</linearGradient>
						<linearGradient id="ribbon" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0" stop-color="#f9e4b4" />
							<stop offset="1" stop-color="#d59a33" />
						</linearGradient>
						<radialGradient id="glow-inner">
							<stop offset="0" stop-color="#fff8dc" stop-opacity="1" />
							<stop offset="1" stop-color="#f0c36a" stop-opacity="0" />
						</radialGradient>
					</defs>

					<ellipse cx="120" cy="222" rx="94" ry="12" fill="rgba(0,0,0,.35)" />

					<!-- Light escaping once the lid moves -->
					<ellipse class="inner-glow" cx="120" cy="104" rx="104" ry="60" fill="url(#glow-inner)" />

					<!-- Box body -->
					<rect x="38" y="104" width="164" height="114" rx="8" fill="url(#box-side)" />
					<rect x="38" y="104" width="164" height="16" fill="rgba(0,0,0,.2)" />
					<rect class="ribbon-v" x="104" y="104" width="32" height="114" fill="url(#ribbon)" />

					<!-- Lid, with its bow -->
					<g class="lid">
						<rect x="26" y="76" width="188" height="36" rx="8" fill="url(#box-lid)" />
						<rect x="104" y="76" width="32" height="36" fill="url(#ribbon)" />
						<g class="bow" style:transform="scale({1 - progress * 0.34}) rotate({progress * -12}deg)">
							<path d="M120 74 C96 34 54 28 48 52 C43 72 88 80 120 74 Z" fill="url(#ribbon)" stroke="#a97418" stroke-width="2" />
							<path d="M120 74 C144 34 186 28 192 52 C197 72 152 80 120 74 Z" fill="url(#ribbon)" stroke="#a97418" stroke-width="2" />
							<path d="M112 76 L86 118 L104 110 L112 124 L118 80 Z" fill="#d59a33" />
							<path d="M128 76 L154 118 L136 110 L128 124 L122 80 Z" fill="#d59a33" />
							<ellipse cx="120" cy="70" rx="13" ry="12" fill="#f0c36a" stroke="#a97418" stroke-width="2" />
						</g>
					</g>
				</svg>
			</button>
		</div>
	{/if}

	{#if errorMessage}<p class="alert alert-bad error" role="alert">{errorMessage}</p>{/if}

	{#if stage === 'spinning'}
		<div class="reel-stage">
			<p class="eyebrow">Santa is checking his list...</p>
			<div class="reel-window" aria-hidden="true">
				<div class="frost-top"></div>
				<div class="frost-bottom"></div>
				<div class="marker"></div>
				<div class="track" bind:this={track}>
					{#each reelPeople as person, index (`${person.id}-${index}`)}
						<div class="tile">
							<Ornament name={person.name} color={person.color} photo={person.photo} size={78} label={false} />
							<span>{person.firstName}</span>
						</div>
					{/each}
				</div>
			</div>
			<p class="visually-hidden" aria-live="polite">Santa is choosing a name.</p>
		</div>
	{/if}

	{#if stage === 'landed' && recipient}
		<div class="result">
			<div class="result-card paper stitched">
				<div class="seal"><WaxSeal size={78} /></div>
				<p class="eyebrow">{helping ? `${profile.firstName} is Secret Santa for` : 'You are Secret Santa for'}</p>
				<div class="winner">
					<Ornament name={recipient.name} color={recipient.color} photo={recipient.photo} size={118} label={false} />
				</div>
				<h1>{recipient.name}</h1>
				<div class="santa-line">
					<SantaFace size={58} />
					<p class="hand">Shh! Not a word to anyone, {helping ? profile.firstName : "now"}. This stays between {helping ? 'us' : 'you and me'}.</p>
				</div>
				<div class="row actions">
					<a class="btn btn-wax" href="/my-person">See {recipient.firstName}'s wish list</a>
					<a class="btn btn-ghost" href="/santa">Ask Santa for ideas</a>
				</div>
			</div>
		</div>
	{/if}

	<a class="home" href="/">
		<Icon name="back" size={18} />
		<span>Back home</span>
	</a>
</div>

<style>
	.scene {
		position: fixed;
		inset: 0;
		z-index: 10;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 20px 16px;
		overflow: hidden;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}

	.dim {
		position: absolute;
		inset: 0;
		background: radial-gradient(70% 55% at 50% 50%, rgba(6, 16, 28, 0.25), rgba(4, 10, 18, 0.72));
		pointer-events: none;
	}

	.spotlight {
		position: absolute;
		inset: 0;
		background: radial-gradient(38% 36% at 50% 56%, rgba(240, 195, 106, calc(0.1 + var(--shake) * 0.3)), transparent 70%);
		pointer-events: none;
		transition: opacity 0.4s;
	}

	.stage-spinning .spotlight,
	.stage-landed .spotlight {
		background: radial-gradient(55% 50% at 50% 45%, rgba(240, 195, 106, 0.32), transparent 70%);
	}

	.burst {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		max-width: none;
		pointer-events: none;
		z-index: 6;
	}

	.sound {
		position: absolute;
		top: calc(14px + env(safe-area-inset-top, 0px));
		right: 14px;
		z-index: 8;
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 7px 13px;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.22);
		background: rgba(255, 255, 255, 0.08);
		color: var(--snow);
		font-weight: 700;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.home {
		position: absolute;
		top: calc(14px + env(safe-area-inset-top, 0px));
		left: 14px;
		z-index: 8;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--mist);
		font-weight: 700;
		font-size: 0.9rem;
		text-decoration: none;
		padding: 7px 10px;
	}

	.intro {
		position: relative;
		z-index: 2;
		text-align: center;
		min-height: 128px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-end;
		gap: 4px;
	}

	.hint {
		color: var(--candle-200);
		font-size: 1.55rem;
		min-height: 1.3em;
	}

	/* ---- The gift ---- */

	.gift-wrap {
		position: relative;
		z-index: 3;
		width: min(78vw, 46vh, 360px);
		aspect-ratio: 1;
	}

	.gift {
		position: absolute;
		inset: 0;
		padding: 0;
		background: none;
		border: 0;
		cursor: pointer;
		touch-action: none;
		-webkit-tap-highlight-color: transparent;
		border-radius: 50%;
	}

	.ring {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;
	}

	.ring-track {
		fill: none;
		stroke: rgba(255, 255, 255, 0.1);
		stroke-width: 4;
	}

	.ring-fill {
		fill: none;
		stroke: var(--candle-400);
		stroke-width: 5;
		stroke-linecap: round;
		filter: drop-shadow(0 0 7px rgba(240, 195, 106, 0.9));
	}

	.box {
		position: absolute;
		inset: 12%;
		width: 76%;
		height: 76%;
		overflow: visible;
		transform-origin: 50% 90%;
		animation: idle-bob 3.2s ease-in-out infinite;
	}

	.stage-holding .box {
		animation: rattle 0.09s linear infinite;
		--amp: calc(var(--shake) * 5deg);
	}

	@keyframes idle-bob {
		0%,
		100% {
			transform: translateY(0) rotate(-1deg);
		}
		50% {
			transform: translateY(-7px) rotate(1deg);
		}
	}

	@keyframes rattle {
		0% {
			transform: rotate(calc(var(--amp) * -1)) translateX(calc(var(--shake) * -3px));
		}
		50% {
			transform: rotate(var(--amp)) translateX(calc(var(--shake) * 3px));
		}
		100% {
			transform: rotate(calc(var(--amp) * -1)) translateX(calc(var(--shake) * -3px));
		}
	}

	.lid {
		transform-box: fill-box;
		transform-origin: 50% 100%;
		transition: transform 0.85s cubic-bezier(0.25, 1.5, 0.45, 1), opacity 0.7s ease 0.15s;
	}

	.open .lid {
		transform: translateY(-190px) rotate(-22deg);
		opacity: 0;
	}

	.bow {
		transform-box: fill-box;
		transform-origin: 50% 100%;
	}

	.inner-glow {
		opacity: 0;
		transition: opacity 0.5s ease;
		transform-box: fill-box;
		transform-origin: 50% 50%;
	}

	.open .inner-glow {
		opacity: 1;
		animation: glow-grow 0.9s ease-out forwards;
	}

	@keyframes glow-grow {
		from {
			transform: scale(0.5);
		}
		to {
			transform: scale(1.8);
		}
	}

	/* ---- The reel ---- */

	.reel-stage {
		position: relative;
		z-index: 4;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
		animation: rise-in 0.4s ease both;
	}

	.reel-window {
		position: relative;
		width: min(78vw, 300px);
		height: 396px;
		max-height: 58vh;
		overflow: hidden;
		border-radius: var(--radius-lg);
		background: linear-gradient(180deg, #0a1625, #142b45 50%, #0a1625);
		box-shadow: 0 0 0 3px var(--candle-600), 0 0 0 7px rgba(240, 195, 106, 0.2), 0 30px 70px -20px rgba(0, 0, 0, 0.9);
	}

	.frost-top,
	.frost-bottom {
		position: absolute;
		left: 0;
		right: 0;
		height: 34%;
		z-index: 3;
		pointer-events: none;
		backdrop-filter: blur(3.5px);
		-webkit-backdrop-filter: blur(3.5px);
	}

	.frost-top {
		top: 0;
		background: linear-gradient(180deg, rgba(190, 215, 240, 0.48), rgba(190, 215, 240, 0));
		-webkit-mask-image: linear-gradient(180deg, #000 55%, transparent);
		mask-image: linear-gradient(180deg, #000 55%, transparent);
	}

	.frost-bottom {
		bottom: 0;
		background: linear-gradient(0deg, rgba(190, 215, 240, 0.48), rgba(190, 215, 240, 0));
		-webkit-mask-image: linear-gradient(0deg, #000 55%, transparent);
		mask-image: linear-gradient(0deg, #000 55%, transparent);
	}

	.marker {
		position: absolute;
		left: 8px;
		right: 8px;
		top: 50%;
		height: 132px;
		transform: translateY(-50%);
		z-index: 4;
		border-radius: 18px;
		border: 2px solid var(--candle-400);
		box-shadow: 0 0 22px rgba(240, 195, 106, 0.55), inset 0 0 22px rgba(240, 195, 106, 0.2);
		pointer-events: none;
	}

	.track {
		will-change: transform;
	}

	.tile {
		height: 132px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 14px;
		color: var(--snow);
		font-family: var(--font-display);
		font-variation-settings: 'SOFT' 100;
		font-size: 1.5rem;
		font-weight: 600;
	}

	/* ---- The result ---- */

	.result {
		position: relative;
		z-index: 5;
		width: 100%;
		max-width: 470px;
		animation: land 0.75s cubic-bezier(0.2, 1.4, 0.4, 1) both;
	}

	@keyframes land {
		from {
			opacity: 0;
			transform: scale(0.55) rotate(-4deg);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}

	.result-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 8px;
		padding: 52px 22px 24px;
		border-radius: var(--radius-lg);
		box-shadow: 0 0 80px 8px rgba(240, 195, 106, 0.32), var(--shadow-card);
	}

	.seal {
		position: absolute;
		top: -36px;
		left: 50%;
		transform: translateX(-50%);
	}

	.winner {
		animation: drop-swing 1.6s ease-out 0.25s both;
		transform-origin: 50% -30%;
	}

	@keyframes drop-swing {
		0% {
			transform: rotate(14deg);
		}
		30% {
			transform: rotate(-9deg);
		}
		60% {
			transform: rotate(5deg);
		}
		100% {
			transform: rotate(0);
		}
	}

	.result-card h1 {
		color: var(--cran-700);
		font-size: clamp(2.2rem, 9vw, 3.1rem);
	}

	.santa-line {
		display: flex;
		align-items: center;
		gap: 10px;
		text-align: left;
		margin: 6px 0 8px;
	}

	.santa-line .hand {
		font-size: 1.4rem;
		color: var(--ink-700);
	}

	.actions {
		justify-content: center;
	}

	.error {
		position: relative;
		z-index: 5;
	}

	@media (max-height: 640px) {
		.intro {
			min-height: 86px;
		}
		h1 {
			font-size: 1.6rem;
		}
		.hint {
			font-size: 1.25rem;
		}
	}
</style>
