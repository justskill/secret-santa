<script lang="ts">
	import { page } from '$app/state';
	import SantaFace from '$lib/components/SantaFace.svelte';
</script>

<svelte:head>
	<title>Oh dear | Secret Santa</title>
</svelte:head>

<main class="page narrow error-page">
	<div class="paper stitched rise">
		<SantaFace size={92} />
		<h1>Oh, dear me.</h1>
		<p>{page.error?.message ?? 'Something went wrong in the workshop.'}</p>
		<a class="btn btn-wax" href="/">Back to the workshop</a>
	</div>
</main>

<style>
	.error-page {
		min-height: 90dvh;
		display: grid;
		place-items: center;
	}

	.paper {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 14px;
		padding: 34px 26px;
		max-width: 460px;
	}

	h1 {
		color: var(--pine-800);
		font-size: 2rem;
	}
</style>
