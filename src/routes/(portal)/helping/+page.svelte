<script lang="ts">
	import { enhance } from '$app/forms';
	import Ornament from '$lib/components/Ornament.svelte';

	let { data, form } = $props();
</script>

<svelte:head>
	<title>People you help | Secret Santa</title>
</svelte:head>

<main class="page narrow stack">
	<div class="page-title">
		<h1>People you help</h1>
		<p>When someone wants to buy an off-list gift for these people, Santa brings the permission slip to you. You can also whisper advice to their Santa here.</p>
	</div>

	{#each data.people as person (person.id)}
		<section class="paper rise">
			<div class="row head">
				<Ornament name={person.name} color={person.color} photo={person.photo} size={54} label={false} />
				<h2>{person.name}</h2>
			</div>
			<form method="POST" class="stack-sm" use:enhance={() => async ({ update }) => update({ reset: false })}>
				<input type="hidden" name="person" value={person.id} />
				{#if form?.savedFor === person.id}<p class="alert alert-good small" role="status">Saved.</p>{/if}
				{#if person.kind === 'kid'}
					<div class="field">
						<label for="notes-{person.id}">Shopping notes</label>
						<textarea id="notes-{person.id}" name="notes" rows="3" placeholder="Age, sizes, likes, what to avoid">{person.guidance.notes}</textarea>
					</div>
				{/if}
				<div class="field">
					<label for="helper-{person.id}">A whisper to {person.firstName}'s Santa</label>
					<textarea id="helper-{person.id}" name="helper_notes" rows="3" placeholder="Already bought the big telescope, so skip that.">{person.guidance.helper_notes}</textarea>
					<span class="field-hint">Only the person who drew {person.firstName} sees this. They won't know who wrote it.{person.kind === 'adult' ? ` ${person.firstName} won't see it either.` : ''}</span>
				</div>
				<button class="btn btn-pine btn-sm">Save</button>
			</form>
		</section>
	{:else}
		<section class="paper">
			<p class="empty">Nobody has been assigned to you. Your organizer can set this up.</p>
		</section>
	{/each}
</main>

<style>
	.head {
		margin-bottom: 12px;
	}
</style>
