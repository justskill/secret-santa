<script lang="ts">
	let { size = 96 }: { size?: number } = $props();
	const uid = $props.id();
</script>

<svg class="gift" width={size} height={size} viewBox="0 0 240 240" aria-hidden="true">
	<defs>
		<linearGradient id="{uid}-side" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stop-color="#2f7a63" />
			<stop offset="1" stop-color="#143a30" />
		</linearGradient>
		<linearGradient id="{uid}-lid" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stop-color="#3d9478" />
			<stop offset="1" stop-color="#1c4d40" />
		</linearGradient>
		<linearGradient id="{uid}-ribbon" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#f9e4b4" />
			<stop offset="1" stop-color="#d59a33" />
		</linearGradient>
	</defs>
	<ellipse cx="120" cy="222" rx="90" ry="11" fill="rgba(0,0,0,.3)" />
	<rect x="38" y="104" width="164" height="114" rx="8" fill="url(#{uid}-side)" />
	<rect x="38" y="104" width="164" height="16" fill="rgba(0,0,0,.2)" />
	<rect x="104" y="104" width="32" height="114" fill="url(#{uid}-ribbon)" />
	<rect x="26" y="76" width="188" height="36" rx="8" fill="url(#{uid}-lid)" />
	<rect x="104" y="76" width="32" height="36" fill="url(#{uid}-ribbon)" />
	<path d="M120 74 C96 34 54 28 48 52 C43 72 88 80 120 74 Z" fill="url(#{uid}-ribbon)" stroke="#a97418" stroke-width="2" />
	<path d="M120 74 C144 34 186 28 192 52 C197 72 152 80 120 74 Z" fill="url(#{uid}-ribbon)" stroke="#a97418" stroke-width="2" />
	<ellipse cx="120" cy="70" rx="13" ry="12" fill="#f0c36a" stroke="#a97418" stroke-width="2" />
</svg>

<style>
	.gift {
		flex: none;
		transform-origin: 50% 90%;
		filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.4));
		animation: nudge 3.4s ease-in-out infinite;
	}

	/* Mostly still, with a little rattle now and then, as if something inside is waiting. */
	@keyframes nudge {
		0%,
		76%,
		100% {
			transform: rotate(0);
		}
		80% {
			transform: rotate(-5deg);
		}
		84% {
			transform: rotate(5deg);
		}
		88% {
			transform: rotate(-3deg);
		}
		92% {
			transform: rotate(3deg);
		}
	}
</style>
