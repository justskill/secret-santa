<script lang="ts">
	import { enhance } from '$app/forms';
	import FlipCountdown from '$lib/components/FlipCountdown.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { formatDate } from '$lib/time';

	let { data, form } = $props();
	let newKind = $state('list_deadline');

	const KINDS = [
		{ value: 'list_deadline', label: 'Wish list deadline' },
		{ value: 'exchange', label: 'Secret Santa day' },
		{ value: 'custom', label: 'Something else' }
	];
</script>

<main class="page stack">
	<div class="page-title">
		<h1>Dates and countdowns</h1>
		<p>These show as flip clocks on everyone's home page. Secret Santa day can be any date you like. Times are in {data.timeZone}.</p>
	</div>

	{#if form?.message}
		<p class="alert {form.ok ? 'alert-good' : 'alert-bad'}" role="status">{form.message}</p>
	{/if}

	{#if !data.hasSeason}
		<section class="paper"><p>Start a season on the <a href="/admin/season">draw page</a> first.</p></section>
	{:else}
		<div class="grid-2">
			{#each data.countdowns as countdown (countdown.id)}
				<section class="paper item">
					<FlipCountdown target={countdown.target_at} title={countdown.title} subtitle={countdown.subtitle} dateLabel={formatDate(countdown.target_at, data.timeZone)} size="small" tone={countdown.kind === 'exchange' ? 'wax' : 'gold'} />
					<details>
						<summary>Edit</summary>
						<form method="POST" action="?/update" class="stack-sm form" use:enhance={() => async ({ update }) => update({ reset: false })}>
							<input type="hidden" name="id" value={countdown.id} />
							<div class="field">
								<label for="title-{countdown.id}">Name</label>
								<input id="title-{countdown.id}" name="title" type="text" value={countdown.title} required />
							</div>
							<div class="field">
								<label for="subtitle-{countdown.id}">Short note</label>
								<input id="subtitle-{countdown.id}" name="subtitle" type="text" value={countdown.subtitle} />
							</div>
							<div class="field">
								<label for="when-{countdown.id}">Date and time</label>
								<input id="when-{countdown.id}" name="when" type="datetime-local" value={countdown.input} required />
							</div>
							<div class="field">
								<label for="kind-{countdown.id}">Type</label>
								<select id="kind-{countdown.id}" name="kind" value={countdown.kind}>
									{#each KINDS as kind}<option value={kind.value}>{kind.label}</option>{/each}
								</select>
							</div>
							<label class="check"><input type="checkbox" name="hard_lock" checked={!!countdown.hard_lock} /><span>Lock wish lists when this passes<small>Only applies to a wish list deadline.</small></span></label>
							<label class="check"><input type="checkbox" name="visible" checked={!!countdown.visible} /> Show it to the family</label>
							<div class="row">
								<button class="btn btn-pine btn-sm">Save</button>
							</div>
						</form>
						<form method="POST" action="?/delete" class="remove" use:enhance={({ cancel }) => {
							if (!confirm(`Remove "${countdown.title}"? Reminders tied to it are removed too.`)) cancel();
						}}>
							<input type="hidden" name="id" value={countdown.id} />
							<button class="btn-link small">Remove this countdown</button>
						</form>
					</details>
				</section>
			{/each}
		</div>

		<section class="paper stitched">
			<h2>Add a countdown</h2>
			<form method="POST" action="?/create" class="stack-sm form" use:enhance>
				<div class="form-grid two">
					<div class="field">
						<label for="kind">Type</label>
						<select id="kind" name="kind" bind:value={newKind}>
							{#each KINDS as kind}<option value={kind.value}>{kind.label}</option>{/each}
						</select>
					</div>
					<div class="field">
						<label for="title">Name</label>
						<input id="title" name="title" type="text" required value={newKind === 'list_deadline' ? 'Wish lists due' : newKind === 'exchange' ? 'Secret Santa day' : ''} />
					</div>
					<div class="field">
						<label for="when">Date and time</label>
						<input id="when" name="when" type="datetime-local" required />
					</div>
					<div class="field">
						<label for="subtitle">Short note (optional)</label>
						<input id="subtitle" name="subtitle" type="text" />
					</div>
				</div>
				{#if newKind === 'list_deadline'}
					<label class="check"><input type="checkbox" name="hard_lock" /><span>Lock wish lists when this passes<small>If this stays off, late changes are still allowed.</small></span></label>
				{/if}
				<label class="check"><input type="checkbox" name="visible" checked /> Show it to the family</label>
				<button class="btn btn-wax"><Icon name="plus" size={18} /> Add countdown</button>
			</form>
		</section>
	{/if}
</main>

<style>
	.item {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	summary {
		cursor: pointer;
		font-weight: 800;
		color: var(--cran-700);
	}

	.form {
		margin-top: 12px;
	}

	.remove {
		margin-top: 12px;
	}
</style>
