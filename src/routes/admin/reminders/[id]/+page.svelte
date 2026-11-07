<script lang="ts">
	import { enhance } from '$app/forms';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { smsLink } from '$lib/sms';

	let { data, form } = $props();

	let draft = $derived(data.reminder.draft ?? '');

	function firstName(name: string): string {
		return name.split(/\s+/)[0];
	}

	/** Personalizes the text for a parent, so they know which kid's list it's about. */
	function textFor(recipient: { name: string; about: string[] }): string {
		if (!recipient.about.length) return draft;
		const kids = recipient.about.join(' and ');
		return `${draft} (This one is for ${kids}, ${firstName(recipient.name)}.)`;
	}

	const remaining = $derived(data.recipients.filter((recipient) => !recipient.sent_at).length);
</script>

<main class="page narrow stack">
	<a class="back" href="/admin/reminders"><Icon name="back" size={16} /> Back to the desk</a>

	<div class="page-title">
		<h1>{data.reminder.title}</h1>
		<p>For: {data.audienceLabel.toLowerCase()}. {data.reminder.ntfy_result ?? ''}</p>
	</div>

	{#if form?.message}<p class="alert alert-good" role="status">{form.message}</p>{/if}

	<section class="paper stitched">
		<h2>The text</h2>
		<form method="POST" action="?/save" class="stack-sm form" use:enhance={() => async ({ update }) => update({ reset: false })}>
			<div class="field">
				<label class="visually-hidden" for="draft">Text message</label>
				<textarea id="draft" name="draft" rows="4" bind:value={draft}></textarea>
			</div>
			<div class="row">
				<CopyButton text={draft} label="Copy for a group text" />
				<button class="btn btn-quiet btn-sm">Save wording</button>
				<button class="btn btn-quiet btn-sm" formaction="?/rewrite"><Icon name="wand" size={16} /> Rewrite</button>
			</div>
		</form>
	</section>

	<section class="paper">
		<div class="row between">
			<h2>Who to text</h2>
			<span class="chip {remaining ? 'chip-warn' : 'chip-good'}">{remaining ? `${remaining} left` : 'All sent'}</span>
		</div>
		<p class="small muted-ink tip">Tap a name to open your Messages app with the text filled in. Group texts vary too much by phone, so use the copy button for those.</p>
		<ul class="people">
			{#each data.recipients as recipient (recipient.person_id)}
				<li class:sent={recipient.sent_at}>
					<div class="grow">
						<strong>{recipient.name}</strong>
						{#if recipient.about.length}<p class="small muted-ink">About {recipient.about.join(' and ')}</p>{/if}
					</div>
					{#if recipient.phone}
						<a class="btn btn-gold btn-sm" href={smsLink(recipient.phone, textFor(recipient))}><Icon name="sms" size={16} /> Text</a>
					{:else}
						<a class="small" href="/admin/people/{recipient.person_id}">Add a number</a>
					{/if}
					<form method="POST" action="?/sent" use:enhance={() => async ({ update }) => update({ reset: false })}>
						<input type="hidden" name="person" value={recipient.person_id} />
						<input type="hidden" name="sent" value={recipient.sent_at ? '0' : '1'} />
						<button class="tick" aria-label={recipient.sent_at ? `Mark ${recipient.name} as not sent` : `Mark ${recipient.name} as sent`} aria-pressed={!!recipient.sent_at}>
							{#if recipient.sent_at}<Icon name="check" size={18} />{/if}
						</button>
					</form>
				</li>
			{:else}
				<li class="muted-ink">Nobody needs this one.</li>
			{/each}
		</ul>
		{#if data.reminder.status === 'ready'}
			<form method="POST" action="?/done" use:enhance>
				<button class="btn btn-pine"><Icon name="check" size={18} /> File this one away</button>
			</form>
		{/if}
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

	.form {
		margin-top: 10px;
	}

	.tip {
		margin: 6px 0 4px;
	}

	.people {
		list-style: none;
		margin: 8px 0 14px;
		padding: 0;
	}

	.people li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 11px 0;
		border-bottom: 1.5px dashed var(--paper-300);
	}

	.people li.sent strong {
		text-decoration: line-through;
		color: var(--ink-500);
	}

	.tick {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		border: 2px solid var(--paper-300);
		background: none;
		color: #fff;
		cursor: pointer;
		flex: none;
	}

	.sent .tick {
		background: var(--pine-500);
		border-color: var(--pine-500);
	}
</style>
