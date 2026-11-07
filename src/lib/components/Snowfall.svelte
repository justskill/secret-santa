<script lang="ts">
	import { onMount } from 'svelte';

	let { intensity = 1 }: { intensity?: number } = $props();
	let canvas: HTMLCanvasElement;

	onMount(() => {
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const context = canvas.getContext('2d');
		if (!context) return;
		const ctx: CanvasRenderingContext2D = context;

		let width = 0;
		let height = 0;
		let frame = 0;
		let last = performance.now();

		interface Flake {
			x: number;
			y: number;
			radius: number;
			speed: number;
			drift: number;
			phase: number;
			alpha: number;
		}
		let flakes: Flake[] = [];

		const spawn = (anywhere: boolean): Flake => {
			const depth = Math.random();
			return {
				x: Math.random() * width,
				y: anywhere ? Math.random() * height : -8,
				radius: 0.8 + depth * 2.6,
				speed: 14 + depth * 40,
				drift: 6 + depth * 18,
				phase: Math.random() * Math.PI * 2,
				alpha: 0.35 + depth * 0.55
			};
		};

		const resize = () => {
			const ratio = Math.min(window.devicePixelRatio || 1, 2);
			width = window.innerWidth;
			height = window.innerHeight;
			canvas.width = width * ratio;
			canvas.height = height * ratio;
			canvas.style.width = `${width}px`;
			canvas.style.height = `${height}px`;
			ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
			const target = Math.round(Math.min(width * height, 1_600_000) / 15000 * intensity);
			flakes = Array.from({ length: target }, () => spawn(true));
		};

		const draw = (now: number) => {
			const dt = Math.min((now - last) / 1000, 0.05);
			last = now;
			ctx.clearRect(0, 0, width, height);
			ctx.fillStyle = '#fff';
			for (let i = 0; i < flakes.length; i++) {
				const flake = flakes[i];
				flake.y += flake.speed * dt;
				flake.phase += dt;
				flake.x += Math.sin(flake.phase) * flake.drift * dt;
				if (flake.y > height + 6) flakes[i] = spawn(false);
				ctx.globalAlpha = flake.alpha;
				ctx.beginPath();
				ctx.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
				ctx.fill();
			}
			frame = requestAnimationFrame(draw);
		};

		// Stop drawing while the tab is hidden, so it does not drain a phone's battery.
		const onVisibility = () => {
			cancelAnimationFrame(frame);
			if (!document.hidden) {
				last = performance.now();
				frame = requestAnimationFrame(draw);
			}
		};

		resize();
		frame = requestAnimationFrame(draw);
		window.addEventListener('resize', resize);
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener('resize', resize);
			document.removeEventListener('visibilitychange', onVisibility);
		};
	});
</script>

<canvas bind:this={canvas} class="snow" aria-hidden="true"></canvas>

<style>
	.snow {
		position: fixed;
		inset: 0;
		z-index: 1;
		pointer-events: none;
		max-width: none;
	}
</style>
