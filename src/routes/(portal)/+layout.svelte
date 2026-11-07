<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import PortalNav from '$lib/components/PortalNav.svelte';

	let { children } = $props();

	// The profile picker and the draw ceremony each take over the full screen.
	const fullScreen = $derived(page.route.id === '/(portal)/profiles' || page.route.id === '/(portal)/draw');

	// The active profile belongs to the sign-in, not the tab. If a parent switches to a kid in one tab,
	// other tabs reload to match, so they can't add a wish to the wrong person's list by mistake.
	let channel = $state<BroadcastChannel | null>(null);
	const profileId = $derived(page.data.viewer?.profile.id);

	onMount(() => {
		if (!('BroadcastChannel' in window)) return;
		const opened = new BroadcastChannel('santa-profile');
		opened.onmessage = (event) => {
			if (event.data !== profileId) location.reload();
		};
		channel = opened;
		return () => opened.close();
	});

	$effect(() => {
		channel?.postMessage(profileId);
	});
</script>

{#if !fullScreen}
	<PortalNav />
{/if}
{@render children()}
