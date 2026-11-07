<script lang="ts">
	let {
		name,
		color = 'cranberry',
		photo = null,
		size = 56,
		label = true
	}: { name: string; color?: string; photo?: string | null; size?: number; label?: boolean } = $props();

	const PALETTE: Record<string, [string, string, string]> = {
		cranberry: ['#e85c74', '#b8243f', '#6f1224'],
		pine: ['#58ad8e', '#256c56', '#0f3d31'],
		gold: ['#f8dc94', '#dba23c', '#8c5f14'],
		midnight: ['#6d97c6', '#2c5587', '#122a4a'],
		plum: ['#b583d1', '#7a3f9e', '#42205a'],
		teal: ['#5cc3c4', '#1d8086', '#0b4448'],
		copper: ['#eaa77b', '#b9632f', '#6d3513'],
		rose: ['#f3a6c0', '#cf5688', '#7d2a50']
	};

	const colors = $derived(PALETTE[color] ?? PALETTE.cranberry);
	const initial = $derived(name.trim().charAt(0).toUpperCase() || '?');
	const uid = $props.id();
</script>

<span class="ornament" style:--size="{size}px" aria-hidden={!label} title={label ? name : undefined}>
	<svg viewBox="0 0 100 118" width={size} height={size * 1.18}>
		<defs>
			<radialGradient id={uid} cx="0.35" cy="0.3" r="0.85">
				<stop offset="0" stop-color={colors[0]} />
				<stop offset="0.55" stop-color={colors[1]} />
				<stop offset="1" stop-color={colors[2]} />
			</radialGradient>
			<clipPath id="{uid}-clip"><circle cx="50" cy="68" r="44" /></clipPath>
		</defs>
		<!-- Hook and cap -->
		<path d="M50 4 a6 6 0 1 1 -0.1 0" fill="none" stroke="#c9a14f" stroke-width="3" />
		<rect x="38" y="15" width="24" height="12" rx="3" fill="#e3ab45" />
		<path d="M41 17 v8 M47 17 v8 M53 17 v8 M59 17 v8" stroke="#9a6b1d" stroke-width="1.5" />

		<circle cx="50" cy="68" r="46" fill="url(#{uid})" />
		{#if photo}
			<image href={photo} x="6" y="24" width="88" height="88" clip-path="url(#{uid}-clip)" preserveAspectRatio="xMidYMid slice" />
			<circle cx="50" cy="68" r="44" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2" />
		{:else}
			<path d="M8 58 q10 8 21 0 t21 0 t21 0 t21 0" stroke="rgba(255,255,255,.28)" stroke-width="3" fill="none" />
			<path d="M8 84 q10 -8 21 0 t21 0 t21 0 t21 0" stroke="rgba(255,255,255,.2)" stroke-width="3" fill="none" />
			<text
				x="50"
				y="72"
				text-anchor="middle"
				dominant-baseline="middle"
				font-family="Fraunces Variable, Georgia, serif"
				font-weight="700"
				font-size="40"
				fill="#fff8e8">{initial}</text
			>
		{/if}
		<ellipse cx="33" cy="45" rx="11" ry="7" fill="rgba(255,255,255,.34)" transform="rotate(-28 33 45)" />
	</svg>
</span>

<style>
	.ornament {
		display: inline-flex;
		flex: none;
		filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.32));
	}
</style>
