<script lang="ts">
	let { size = 64 }: { size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" class="seal">
	<defs>
		<radialGradient id="wax" cx="0.35" cy="0.3" r="0.9">
			<stop offset="0" stop-color="#e2556e" />
			<stop offset="0.55" stop-color="#ad1f3a" />
			<stop offset="1" stop-color="#6d1022" />
		</radialGradient>
	</defs>
	<path
		d="M50 4 C58 2 64 9 71 9 C79 9 84 16 88 22 C93 28 91 36 95 43 C99 50 94 57 93 64 C92 72 85 76 80 82 C75 88 67 87 60 92 C53 97 45 94 38 92 C30 90 24 90 19 83 C14 76 8 72 6 64 C4 56 2 50 5 42 C8 34 10 27 16 21 C22 15 29 12 36 9 C41 7 44 5 50 4 Z"
		fill="url(#wax)"
	/>
	<circle cx="50" cy="50" r="30" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="2.5" />
	<circle cx="50" cy="50" r="25" fill="rgba(70,8,20,.28)" />
	<path d="M50 30 L55.500 44 L70 45 L58.500 54 L62.500 68.500 L50 60.500 L37.500 68.500 L41.500 54 L30 45 L44.500 44 Z" fill="rgba(255,226,180,.82)" />
</svg>

<style>
	.seal {
		flex: none;
		filter: drop-shadow(0 4px 8px rgba(60, 5, 15, 0.45));
	}
</style>
