<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import { formatDateTime } from '$lib/time';

	let { data, form } = $props();
</script>

<main class="page stack">
	<div class="page-title">
		<h1>The Reminder Desk</h1>
		<p>When a reminder comes due, Santa writes the text, works out who needs it, and pings your phone. You tap a name, your Messages app opens with the text filled in, and you hit send.</p>
	</div>

	{#if form?.message}
		<p class="alert {form.ok ? 'alert-good' : 'alert-bad'}" role="status">{form.message}</p>
	{/if}

	{#if !data.hasSeason}
		<section class="paper"><p>Start a season on the <a href="/admin/season">draw page</a> first.</p></section>
	{:else}
		{#if !data.ntfyOn}
			<p class="alert alert-warn">ntfy isn't connected, so reminders will wait here without pinging your phone. <a href="/admin/settings">Connect it in Settings</a>.</p>
		{/if}

		<section class="stack-sm">
			<h2 class="section">Ready to send</h2>
			{#each data.ready as reminder (reminder.id)}
				<a class="paper ready rise" href="/admin/reminders/{reminder.id}">
					<Icon name="sms" size={26} />
					<div class="grow">
						<strong>{reminder.title}</strong>
						<p class="small muted-ink">{reminder.sent} of {reminder.total} sent</p>
					</div>
					<span class="btn btn-wax btn-sm">Open</span>
				</a>
			{:else}
				<p class="frost small">Nothing to send right now.</p>
			{/each}
		</section>

		<section class="paper">
			<div class="row between">
				<h2>Coming up</h2>
				<form method="POST" action="?/plan" use:enhance>
					<button class="btn btn-gold btn-sm"><Icon name="wand" size={16} /> Plan reminders for me</button>
				</form>
			</div>
			{#if data.scheduled.length}
				<ul class="list">
					{#each data.scheduled as reminder (reminder.id)}
						<li>
							<div class="row between nowrap">
								<div class="grow">
									<strong>{reminder.title}</strong>
									<p class="small muted-ink">{formatDateTime(reminder.fire_at, data.timeZone)} to {data.audiences[reminder.audience].toLowerCase()}</p>
								</div>
							</div>
							<details>
								<summary>Edit</summary>
								<form method="POST" action="?/update" class="stack-sm form" use:enhance={() => async ({ update }) => update({ reset: false })}>
									<input type="hidden" name="id" value={reminder.id} />
									<div class="field">
										<label for="title-{reminder.id}">Title</label>
										<input id="title-{reminder.id}" name="title" type="text" value={reminder.title} required />
									</div>
									<div class="form-grid two">
										<div class="field">
											<label for="when-{reminder.id}">When</label>
											<input id="when-{reminder.id}" name="when" type="datetime-local" value={reminder.input} required />
										</div>
										<div class="field">
											<label for="aud-{reminder.id}">Who</label>
											<select id="aud-{reminder.id}" name="audience" value={reminder.audience}>
												{#each Object.entries(data.audiences) as [value, label]}<option {value}>{label}</option>{/each}
											</select>
										</div>
									</div>
									<div class="field">
										<label for="text-{reminder.id}">Your own wording (optional)</label>
										<textarea id="text-{reminder.id}" name="text" rows="2" placeholder="Leave this empty and Santa will write it.">{reminder.custom_text ?? ''}</textarea>
									</div>
									<label class="check"><input type="checkbox" name="post_notice" checked={!!reminder.post_notice} /> Also post it as a notice in the portal</label>
									<button class="btn btn-pine btn-sm">Save</button>
								</form>
								<div class="row after">
									<form method="POST" action="?/fireNow" use:enhance>
										<input type="hidden" name="id" value={reminder.id} />
										<button class="btn btn-quiet btn-sm">Send to the desk now</button>
									</form>
									<form method="POST" action="?/delete" use:enhance>
										<input type="hidden" name="id" value={reminder.id} />
										<button class="btn-link small">Remove</button>
									</form>
								</div>
							</details>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="empty">Nothing scheduled. Add your dates, then let Santa plan the reminders.</p>
			{/if}
		</section>

		<section class="paper stitched">
			<h2>Add a reminder</h2>
			<form method="POST" action="?/create" class="stack-sm form" use:enhance>
				<div class="field">
					<label for="title">Title</label>
					<input id="title" name="title" type="text" placeholder="Don't forget to wrap your gifts" required />
				</div>
				<div class="form-grid two">
					<div class="field">
						<label for="when">When ({data.timeZone})</label>
						<input id="when" name="when" type="datetime-local" required />
					</div>
					<div class="field">
						<label for="audience">Who</label>
						<select id="audience" name="audience">
							{#each Object.entries(data.audiences) as [value, label]}<option {value}>{label}</option>{/each}
						</select>
					</div>
				</div>
				<div class="field">
					<label for="text">Your own wording (optional)</label>
					<textarea id="text" name="text" rows="2" placeholder="Leave this empty and Santa will write it."></textarea>
				</div>
				<label class="check"><input type="checkbox" name="post_notice" checked /> Also post it as a notice in the portal</label>
				<button class="btn btn-wax"><Icon name="plus" size={18} /> Schedule it</button>
			</form>
		</section>

		{#if data.finished.length}
			<section class="paper">
				<h2>Finished</h2>
				<ul class="list">
					{#each data.finished as reminder (reminder.id)}
						<li>
							<strong>{reminder.title}</strong>
							<p class="small muted-ink">{reminder.ntfy_result ?? (reminder.status === 'cancelled' ? 'Cancelled.' : 'Sent.')}</p>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}
</main>

<style>
	.section {
		color: var(--candle-200);
		font-size: 1.3rem;
		text-shadow: 0 1px 6px rgba(3, 9, 17, 0.9);
	}

	.ready {
		display: flex;
		align-items: center;
		gap: 14px;
		text-decoration: none;
		color: var(--ink-900) !important;
		padding: 16px 18px;
		background-color: #fff3d9;
		box-shadow: 0 0 0 2px var(--candle-500), var(--shadow-card);
	}

	.ready :global(svg) {
		color: var(--cran-600);
	}

	.list {
		list-style: none;
		margin: 12px 0 0;
		padding: 0;
	}

	.list li {
		padding: 12px 0;
		border-bottom: 1.5px dashed var(--paper-300);
	}

	.list li:last-child {
		border-bottom: 0;
	}

	summary {
		cursor: pointer;
		font-weight: 800;
		font-size: 0.9rem;
		color: var(--cran-700);
		margin-top: 6px;
	}

	.form {
		margin-top: 12px;
	}

	.after {
		margin-top: 10px;
	}
</style>
