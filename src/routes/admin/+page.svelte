<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import { formatDateTime, relativeTime } from '$lib/time';

	let { data } = $props();

	const usd = (value: number) => `$${value.toFixed(value < 1 ? 3 : 2)}`;
	const spendPercent = $derived(Math.min(100, (data.spend.total / Math.max(data.spend.budget, 0.01)) * 100));

	const BLOCKED_LABELS: Record<string, string> = {
		daily_cap: 'held back by the daily limit',
		budget: 'held back by the budget',
		disabled: 'sent while Santa was switched off',
		unavailable: 'sent with no connection to Anthropic',
		busy: 'sent while Santa was still answering'
	};

	/** Totals only, with no names: how often Santa came up short this season. */
	const outcomeLine = $derived.by(() => {
		const { declined, cutOff, tangled, blocked, failed } = data.outcomes;
		const parts = [
			declined ? `${declined} declined` : '',
			cutOff ? `${cutOff} cut off` : '',
			tangled ? `${tangled} ran out of steps` : '',
			...blocked.map((row) => `${row.count} ${BLOCKED_LABELS[row.reason] ?? 'held back'}`),
			failed ? `${failed} failed` : ''
		].filter(Boolean);
		return parts.length ? `This season: ${parts.join(', ')}.` : '';
	});
</script>

<main class="page stack">
	<div class="page-title">
		<h1>{data.hasSeason ? data.seasonName : 'No season yet'}</h1>
		<p>You run the workshop, but even you can't see who drew whom.</p>
	</div>

	{#if !data.hasSeason}
		<section class="paper">
			<p>Start a season to begin.</p>
			<a class="btn btn-wax" href="/admin/season">Go to the draw</a>
		</section>
	{:else}
		{#if data.readyReminders?.length}
			<section class="paper desk rise">
				<div class="row between">
					<h2><Icon name="bell" /> Texts waiting for you</h2>
					<a class="btn btn-wax btn-sm" href="/admin/reminders">Open the Reminder Desk</a>
				</div>
				<ul>
					{#each data.readyReminders as reminder (reminder.id)}
						<li><a href="/admin/reminders/{reminder.id}">{reminder.title}</a></li>
					{/each}
				</ul>
			</section>
		{/if}

		<div class="stats">
			<article class="paper stat">
				<span class="eyebrow">Drawn</span>
				<strong>{data.progress?.revealed} <small>of {data.progress?.total}</small></strong>
				{#if data.notDrawnNames?.length}<p class="small muted-ink">Waiting on {data.notDrawnNames.join(', ')}</p>{/if}
				{#if data.redrawing}<p class="small muted-ink">Plus {data.redrawing} drawing again after a change. Santa has told them, and you won't see who.</p>{/if}
			</article>
			<article class="paper stat">
				<span class="eyebrow">Lists ready</span>
				<strong>{data.listsReady} <small>of {data.participantCount}</small></strong>
				{#if data.notReadyNames?.length}<p class="small muted-ink">Waiting on {data.notReadyNames.join(', ')}</p>{/if}
			</article>
			<article class="paper stat">
				<span class="eyebrow">Gifts</span>
				{#if data.status === 'setup'}
					<strong>Not yet</strong>
				{:else}
					<strong>{(data.participantCount ?? 0) - (data.noGiftNames?.length ?? 0)} <small>have bought</small></strong>
					{#if data.noGiftNames?.length}<p class="small muted-ink">Not yet: {data.noGiftNames.join(', ')}</p>{/if}
				{/if}
			</article>
			<article class="paper stat">
				<span class="eyebrow">Permission slips waiting</span>
				<strong>{data.slipsWaiting}</strong>
				<p class="small muted-ink">Count only. You won't see who asked or what about.</p>
			</article>
		</div>

		<div class="grid-2 wide-left">
			<section class="paper stitched">
				<h2>Your checklist</h2>
				<ol class="steps">
					{#each data.steps ?? [] as step, index}
						<li class:done={step.done}>
							<span class="dot">{#if step.done}<Icon name="check" size={16} />{:else}{index + 1}{/if}</span>
							<div class="grow">
								<a href={step.href}><strong>{step.title}</strong></a>
								<p class="small muted-ink">{step.detail}</p>
							</div>
						</li>
					{/each}
				</ol>
				{#if data.kidsWithoutParents?.length}
					<p class="alert alert-bad small">
						{data.kidsWithoutParents.join(', ')} {data.kidsWithoutParents.length === 1 ? 'has' : 'have'} no parents set, so nobody can open that profile. Fix this on the <a href="/admin/people">People</a> page.
					</p>
				{/if}
				{#if data.noApprover?.length}
					<p class="alert alert-warn small">
						Nobody can approve off-list gifts for {data.noApprover.join(', ')}. Set an approver on the <a href="/admin/people">People</a> page, or their slips will be approved automatically.
					</p>
				{/if}
			</section>

			<div class="stack">
				<section class="paper">
					<h2>Santa's AI budget</h2>
					{#if !data.keySet}
						<p class="alert alert-warn small">No Anthropic API key is set, so Santa chat is off. Everything else still works.</p>
					{:else if !data.aiOn}
						<p class="alert alert-warn small">Santa chat is paused, either by you in Settings or because the budget ran out.</p>
					{/if}
					<p class="spend"><strong>{usd(data.spend.total)}</strong> of ${data.spend.budget} budget</p>
					<div class="meter" role="progressbar" aria-valuenow={spendPercent} aria-valuemin={0} aria-valuemax={100}><span style:width="{spendPercent}%"></span></div>
					<p class="small muted-ink">
						Estimate from list prices. {data.spend.calls} calls, {data.spend.searches} web searches.
						<a href="/admin/settings">Change the budget</a>
					</p>
					{#if outcomeLine}
						<p class="small muted-ink" data-testid="santa-outcomes">{outcomeLine}</p>
					{/if}
				</section>

				{#if data.nextReminder}
					<section class="paper">
						<h2>Next reminder</h2>
						<p><strong>{data.nextReminder.title}</strong></p>
						<p class="small muted-ink">{formatDateTime(data.nextReminder.fire_at, data.timeZone)}</p>
					</section>
				{/if}

				<section class="paper">
					<h2>Recent activity</h2>
					{#if data.audit.length}
						<ul class="audit">
							{#each data.audit as entry (entry.id)}
								<li>
									<span class="small">{entry.action.replace(/[._]/g, ' ')}{entry.detail ? `: ${entry.detail}` : ''}</span>
									<time class="small muted-ink">{relativeTime(entry.at)}</time>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="small muted-ink">Nothing yet.</p>
					{/if}
				</section>
			</div>
		</div>
	{/if}
</main>

<style>
	.desk {
		background-color: #fff3d9;
		box-shadow: 0 0 0 2px var(--candle-500), var(--shadow-card);
	}

	.desk h2 {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 1.25rem;
	}

	.desk ul {
		margin: 10px 0 0;
		padding-left: 20px;
	}

	.stats {
		display: grid;
		gap: 12px;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 215px), 1fr));
	}

	.stat {
		padding: 16px 18px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.stat strong {
		font-family: var(--font-display);
		font-size: 2rem;
		line-height: 1.1;
		color: var(--pine-800);
	}

	.stat small {
		font-size: 1rem;
		font-family: var(--font-body);
		font-weight: 600;
		color: var(--ink-500);
	}

	.steps {
		list-style: none;
		margin: 12px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.steps li {
		display: flex;
		align-items: flex-start;
		gap: 12px;
	}

	.steps a {
		color: var(--ink-900) !important;
		text-decoration: none;
	}

	.steps a:hover {
		text-decoration: underline;
	}

	.dot {
		display: grid;
		place-items: center;
		flex: none;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		font-weight: 900;
		font-size: 0.85rem;
		color: var(--ink-500);
		background: var(--paper-200);
	}

	.done .dot {
		background: var(--pine-500);
		color: #fff;
	}

	.spend {
		margin-top: 8px;
	}

	.meter {
		height: 10px;
		margin: 6px 0;
		border-radius: 999px;
		background: var(--paper-200);
		overflow: hidden;
	}

	.meter span {
		display: block;
		height: 100%;
		background: linear-gradient(90deg, var(--pine-500), var(--candle-500));
	}

	.audit {
		list-style: none;
		margin: 8px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.audit li {
		display: flex;
		justify-content: space-between;
		gap: 10px;
	}

	.audit time {
		flex: none;
	}
</style>
