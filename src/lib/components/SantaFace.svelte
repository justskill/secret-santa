<script lang="ts">
	let { size = 64 }: { size?: number; wink?: boolean } = $props();
</script>

<img class="santa" src="/art/santa.webp" width={size} height={size} alt="Santa" draggable="false" />

<style>
	.santa {
		flex: none;
		display: block;
		object-fit: contain;
		filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.35));
	}
</style>
