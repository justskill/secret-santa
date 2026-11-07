<script lang="ts">
	import '@fontsource-variable/fraunces/full.css';
	import '@fontsource-variable/nunito/index.css';
	import '@fontsource/caveat/600.css';
	import '../app.css';
	import NightSky from '$lib/components/NightSky.svelte';
	import { page } from '$app/state';

	let { children } = $props();

	// The draw ceremony brings its own scene.
	const showSky = $derived(page.route.id !== '/(portal)/draw');
</script>

<svelte:head>
	<title>Secret Santa</title>
</svelte:head>

{#if showSky}
	<NightSky />
{/if}
{@render children()}
