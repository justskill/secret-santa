<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import Ornament from '$lib/components/Ornament.svelte';

	let { data, form } = $props();
	let kind = $state<'adult' | 'kid'>('adult');
	let householdChoice = $state('');
</script>

<main class="page stack">
	<div class="page-title">
		<h1>The family</h1>
		<p>Add everyone, say who belongs to which household, and connect kids to their parents. Kids don't need a login.</p>
	</div>

	<section class="paper">
		<div class="table-wrap">
			<table class="plain">
				<thead>
					<tr>
						<th>Person</th>
						<th>Household</th>
						<th>Parents</th>
						<th>Off-list approver</th>
						<th>Sign-in</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each data.people as person (person.id)}
						<tr class:inactive={!person.active}>
							<td>
								<div class="who">
									<Ornament name={person.name} color={person.color} photo={person.photo} size={34} label={false} />
									<div>
										<strong>{person.name}</strong>
										<div class="tags">
											{#if person.kind === 'kid'}<span class="chip">Kid</span>{/if}
											{#if person.isAdmin}<span class="chip chip-good">Admin</span>{/if}
											{#if !person.active}<span class="chip chip-bad">Inactive</span>{/if}
										</div>
									</div>
								</div>
							</td>
							<td>{person.household ?? '-'}</td>
							<td>{person.kind === 'kid' ? (person.guardians.join(', ') || 'None set') : '-'}</td>
							<td>
								{#if person.approvers.length}
									{person.approvers.join(', ')}
									{#if person.approverIsAutomatic}<span class="small muted-ink"> (auto)</span>{/if}
								{:else}
									<span class="chip chip-warn">None</span>
								{/if}
							</td>
							<td>
								{#if person.kind === 'kid'}
									<span class="small muted-ink">Through parents</span>
								{:else if person.canSignIn}
									<span class="chip chip-good">Can sign in</span>
								{:else if person.invited}
									<span class="chip chip-warn">Invited</span>
								{:else}
									<span class="chip">Needs invite</span>
								{/if}
							</td>
							<td><a class="btn btn-quiet btn-sm" href="/admin/people/{person.id}">Edit</a></td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<div class="grid-2">
		<section class="paper stitched">
			<h2>Add someone</h2>
			<form method="POST" action="?/add" class="stack-sm add" use:enhance>
				{#if form?.addMessage}
					<p class="alert {form.added ? 'alert-good' : 'alert-bad'}" role="status">{form.addMessage}</p>
				{/if}
				<div class="field">
					<label for="name">Name</label>
					<input id="name" name="name" type="text" required />
				</div>
				<fieldset class="kind">
					<legend class="field-label">Adult or kid?</legend>
					<label class="check"><input type="radio" name="kind" value="adult" bind:group={kind} /> Adult, with their own login</label>
					<label class="check"><input type="radio" name="kind" value="kid" bind:group={kind} /> Kid, whose parents use their profile</label>
				</fieldset>
				<div class="field">
					<label for="household">Household</label>
					<select id="household" name="household" bind:value={householdChoice}>
						<option value="">No household</option>
						{#each data.households as household (household.id)}
							<option value={String(household.id)}>{household.name}</option>
						{/each}
					</select>
				</div>
				<div class="field">
					<label for="new_household">Or start a new household</label>
					<input id="new_household" name="new_household" type="text" placeholder="The Claus Family" />
				</div>
				{#if kind === 'adult'}
					<div class="field">
						<label for="phone">Mobile number (optional)</label>
						<input id="phone" name="phone" type="tel" placeholder="+1 555 555 0100" />
						<span class="field-hint">Only used to open your Messages app with a reminder filled in. The app never sends texts itself.</span>
					</div>
				{:else}
					<fieldset class="kind">
						<legend class="field-label">Their parents (who can open this profile)</legend>
						{#each data.adults as adult (adult.id)}
							<label class="check"><input type="checkbox" name="guardians" value={adult.id} checked={!!householdChoice && String(adult.household_id) === householdChoice} /> {adult.name}</label>
						{/each}
					</fieldset>
				{/if}
				<button class="btn btn-wax"><Icon name="plus" size={18} /> Add to the family</button>
			</form>
		</section>

		<section class="paper">
			<h2>Households</h2>
			<p class="small muted-ink intro">People in the same household won't draw each other, if that rule is on.</p>
			{#if form?.householdMessage}<p class="alert alert-info small" role="status">{form.householdMessage}</p>{/if}
			<ul class="households">
				{#each data.households as household (household.id)}
					<li>
						<form method="POST" action="?/renameHousehold" class="row nowrap" use:enhance={() => async ({ update }) => update({ reset: false })}>
							<input type="hidden" name="id" value={household.id} />
							<label class="visually-hidden" for="hh-{household.id}">Household name</label>
							<input id="hh-{household.id}" name="name" type="text" value={household.name} />
							<button class="btn btn-quiet btn-sm">Rename</button>
						</form>
						<form method="POST" action="?/deleteHousehold" use:enhance>
							<input type="hidden" name="id" value={household.id} />
							<button class="icon-only" aria-label="Remove {household.name}"><Icon name="trash" size={18} /></button>
						</form>
					</li>
				{:else}
					<li class="muted-ink small">No households yet.</li>
				{/each}
			</ul>
			<form method="POST" action="?/addHousehold" class="row nowrap" use:enhance>
				<label class="visually-hidden" for="new-hh">New household</label>
				<input id="new-hh" name="name" type="text" placeholder="New household" required />
				<button class="btn btn-pine btn-sm">Add</button>
			</form>
		</section>
	</div>
</main>

<style>
	.who {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 170px;
	}

	.tags {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}

	.inactive {
		opacity: 0.55;
	}

	.add {
		margin-top: 12px;
	}

	.kind {
		border: 0;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 7px;
	}

	.intro {
		margin: 4px 0 12px;
	}

	.households {
		list-style: none;
		margin: 0 0 12px;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.households li {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.households form:first-child {
		flex: 1;
	}

	.icon-only {
		display: grid;
		place-items: center;
		width: 38px;
		height: 38px;
		border: 0;
		border-radius: 50%;
		background: none;
		color: var(--ink-500);
		cursor: pointer;
	}

	.icon-only:hover {
		background: var(--paper-200);
		color: var(--cran-700);
	}
</style>
