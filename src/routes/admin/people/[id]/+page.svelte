<script lang="ts">
	import { enhance } from '$app/forms';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Ornament from '$lib/components/Ornament.svelte';
	import { smsLink } from '$lib/sms';

	let { data, form } = $props();

	let kind = $derived(data.person.kind);
	let color = $derived(data.person.color);

	const inviteText = $derived(
		form?.inviteLink
			? `Ho ho ho, ${form.firstName}! You're invited to the family Secret Santa. Tap this link to set your password: ${form.inviteLink}`
			: ''
	);
</script>

<main class="page narrow stack">
	<a class="back" href="/admin/people"><Icon name="back" size={16} /> Back to the family</a>

	<div class="row head">
		<Ornament name={data.person.name} {color} photo={data.person.photo} size={72} label={false} />
		<h1>{data.person.name}</h1>
	</div>

	{#if form?.message}
		<p class="alert {form.ok ? 'alert-good' : 'alert-bad'}" role="status">{form.message}</p>
	{/if}

	{#if data.person.kind === 'adult'}
		<section class="paper stitched invite">
			<h2>Invite link</h2>
			{#if form?.inviteLink}
				<p class="small">Send this to {form.firstName}. It works once, for 30 days. Any older link has stopped working.</p>
				<code>{form.inviteLink}</code>
				<div class="row">
					<CopyButton text={inviteText} label="Copy invite text" />
					{#if form.phone}
						<a class="btn btn-gold btn-sm" href={smsLink(form.phone, inviteText)}><Icon name="sms" size={16} /> Text it to {form.firstName}</a>
					{/if}
				</div>
			{:else}
				<p class="small">
					{#if data.person.canSignIn}
						{data.person.name} can already sign in. A new link lets them set a new password, which is also how a forgotten password gets fixed.
					{:else if data.person.invited}
						An invite is out. Making a new one cancels the old one.
					{:else}
						Create a link to text to {data.person.name}. They'll choose their own password.
					{/if}
				</p>
				<form method="POST" action="?/invite" use:enhance>
					<button class="btn btn-wax">{data.person.canSignIn ? 'Create a password reset link' : 'Create invite link'}</button>
				</form>
			{/if}
		</section>
	{/if}

	<section class="paper">
		<h2>Details</h2>
		<form method="POST" action="?/save" class="stack-sm details" use:enhance={() => async ({ update }) => update({ reset: false })}>
			<div class="field">
				<label for="name">Name</label>
				<input id="name" name="name" type="text" value={data.person.name} required />
			</div>
			<fieldset class="group">
				<legend class="field-label">Adult or kid?</legend>
				<label class="check"><input type="radio" name="kind" value="adult" bind:group={kind} /> Adult</label>
				<label class="check"><input type="radio" name="kind" value="kid" bind:group={kind} /> Kid</label>
			</fieldset>
			<div class="field">
				<label for="household">Household</label>
				<select id="household" name="household" value={String(data.person.household_id ?? '')}>
					<option value="">No household</option>
					{#each data.households as household (household.id)}
						<option value={String(household.id)}>{household.name}</option>
					{/each}
				</select>
			</div>
			{#if kind === 'adult'}
				<div class="form-grid two">
					<div class="field">
						<label for="username">Sign-in name</label>
						<input id="username" name="username" type="text" autocapitalize="none" value={data.person.username ?? ''} />
					</div>
					<div class="field">
						<label for="phone">Mobile number</label>
						<input id="phone" name="phone" type="tel" value={data.person.phone ?? ''} placeholder="+1 555 555 0100" />
					</div>
				</div>
				<label class="check">
					<input type="checkbox" name="is_admin" checked={data.person.isAdmin} />
					<span>Admin<small>Can use the Head Elf's Office. Admins also can't see the pairings.</small></span>
				</label>
			{:else}
				<fieldset class="group">
					<legend class="field-label">Parents (who can open this profile)</legend>
					{#each data.adults as adult (adult.id)}
						<label class="check"><input type="checkbox" name="guardians" value={adult.id} checked={data.guardianIds.includes(adult.id)} /> {adult.name}</label>
					{/each}
				</fieldset>
			{/if}
			<fieldset class="group">
				<legend class="field-label">Who approves off-list gifts for {data.person.firstName}?</legend>
				<p class="field-hint">Leave these all off to use the automatic choice: {kind === 'kid' ? 'their parents' : 'the other adults in their household'}.</p>
				{#each data.adults as adult (adult.id)}
					<label class="check"><input type="checkbox" name="approvers" value={adult.id} checked={data.approverIds.includes(adult.id)} /> {adult.name}</label>
				{/each}
			</fieldset>
			<fieldset class="group">
				<legend class="field-label">Ornament color</legend>
				<div class="swatches">
					{#each data.colors as option}
						<label class="swatch" class:selected={color === option}>
							<input class="visually-hidden" type="radio" name="color" value={option} bind:group={color} />
							<Ornament name={data.person.name} color={option} size={38} label={false} />
							<span class="visually-hidden">{option}</span>
						</label>
					{/each}
				</div>
			</fieldset>
			<button class="btn btn-pine">Save changes</button>
		</form>
	</section>

	<section class="paper">
		<h2>Photo</h2>
		<p class="small muted-ink">Shows in the draw and on family pages.</p>
		<form method="POST" action="?/photo" enctype="multipart/form-data" class="row photo" use:enhance>
			<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" aria-label="Photo" />
			<button class="btn btn-pine btn-sm">Upload</button>
		</form>
	</section>

	<section class="paper danger">
		<h2>Other actions</h2>
		<div class="row">
			{#if data.person.kind === 'adult'}
				<form method="POST" action="?/signOutEverywhere" use:enhance>
					<button class="btn btn-quiet btn-sm">Sign out everywhere</button>
				</form>
			{/if}
			<form method="POST" action="?/active" use:enhance>
				<input type="hidden" name="active" value={data.person.active ? '0' : '1'} />
				<button class="btn btn-quiet btn-sm">{data.person.active ? 'Deactivate' : 'Reactivate'}</button>
			</form>
			<form method="POST" action="?/delete" use:enhance={({ cancel }) => {
				if (!confirm(`Delete ${data.person.name}? This can't be undone.`)) cancel();
			}}>
				<button class="btn btn-quiet btn-sm delete">Delete</button>
			</form>
		</div>
	</section>
</main>

<style>
	.back {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-weight: 700;
		color: var(--mist);
		text-decoration: none;
		width: fit-content;
	}

	.head {
		gap: 14px;
	}

	.invite {
		display: flex;
		flex-direction: column;
		gap: 10px;
		align-items: flex-start;
	}

	.invite code {
		display: block;
		width: 100%;
		padding: 10px 12px;
		border-radius: 10px;
		background: var(--night-900);
		color: var(--candle-400);
		font-size: 0.86rem;
		word-break: break-all;
	}

	.details {
		margin-top: 12px;
	}

	.group {
		border: 0;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 7px;
	}

	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.swatch {
		padding: 5px;
		border-radius: 12px;
		border: 2px solid transparent;
		cursor: pointer;
	}

	.swatch.selected {
		border-color: var(--candle-600);
		background: var(--paper-200);
	}

	.swatch:focus-within {
		outline: 3px solid var(--candle-400);
	}

	.photo {
		margin-top: 8px;
	}

	.danger .row {
		margin-top: 10px;
	}

	.delete {
		color: var(--cran-700);
	}
</style>
