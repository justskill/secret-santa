<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import { relativeTime } from '$lib/time';

	let { data, form } = $props();

	const stay = () => async ({ update }: { update: (options?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
	const usd = (value: number) => `$${value.toFixed(value < 1 ? 3 : 2)}`;
	const kb = (size: number) => (size > 1_000_000 ? `${(size / 1_000_000).toFixed(1)} MB` : `${Math.ceil(size / 1000)} KB`);
</script>

<main class="page stack">
	<div class="page-title">
		<h1>Settings</h1>
		<p>Secret Santa version {data.version}</p>
	</div>

	{#if form?.message}
		<p class="alert {form.ok ? 'alert-good' : 'alert-bad'}" role="status">{form.message}</p>
	{/if}

	<div class="grid-2">
		<section class="paper">
			<h2>Family</h2>
			<form method="POST" action="?/family" class="stack-sm form" use:enhance={stay}>
				<div class="field">
					<label for="family_name">Family name</label>
					<input id="family_name" name="family_name" type="text" value={data.settings.family_name} required />
				</div>
				<div class="field">
					<label for="timezone">Time zone</label>
					<input id="timezone" name="timezone" type="text" value={data.settings.timezone} required />
					<span class="field-hint">Every date in the app uses this, such as America/Chicago.</span>
				</div>
				<button class="btn btn-pine btn-sm">Save</button>
			</form>
		</section>

		<section class="paper">
			<h2>ntfy alerts for your phone</h2>
			<p class="small muted-ink intro">When a reminder is ready, ntfy pings your phone and tapping it opens the Reminder Desk. Alerts never contain a pairing.</p>
			<form method="POST" action="?/ntfy" class="stack-sm" use:enhance={stay}>
				<div class="field">
					<label for="ntfy_url">Server</label>
					<input id="ntfy_url" name="ntfy_url" type="url" value={data.settings.ntfy_url} />
				</div>
				<div class="field">
					<label for="ntfy_topic">Topic</label>
					<input id="ntfy_topic" name="ntfy_topic" type="text" value={data.settings.ntfy_topic} placeholder="santa-reminders-a-long-random-word" />
					<span class="field-hint">On the public ntfy.sh server, a topic name works like a password, so make it long and hard to guess.</span>
				</div>
				<div class="field">
					<label for="ntfy_token">Access token (optional)</label>
					<input id="ntfy_token" name="ntfy_token" type="password" autocomplete="off" value={data.settings.ntfy_token} />
				</div>
				<label class="check">
					<input type="checkbox" name="ntfy_mail_alerts" checked={data.settings.ntfy_mail_alerts === '1'} />
					<span>Ping me when North Pole Mail arrives<small>Names only the family, so you can nudge someone there. It never says who asked, who it's for, or what it says. Answers going back to a Santa don't ping, because that would point to their family.</small></span>
				</label>
				<div class="row">
					<button class="btn btn-pine btn-sm">Save</button>
					<button class="btn btn-gold btn-sm" formaction="?/ntfyTest"><Icon name="bell" size={16} /> Send a test</button>
				</div>
			</form>
		</section>

		<section class="paper">
			<h2>Santa</h2>
			{#if !data.keySet}
				<p class="alert alert-warn small">No Anthropic API key is set. Add ANTHROPIC_API_KEY to the container's environment to turn Santa on.</p>
			{/if}
			<form method="POST" action="?/santa" class="stack-sm form" use:enhance={stay}>
				<label class="check"><input type="checkbox" name="santa_enabled" checked={data.settings.santa_enabled === '1'} /> Santa chat is on</label>
				<label class="check"><input type="checkbox" name="santa_web_search" checked={data.settings.santa_web_search === '1'} /><span>Let Santa search the web for gift ideas<small>About a penny per search, plus the tokens to read the results.</small></span></label>
				<div class="field">
					<label for="santa_model">Model</label>
					<select id="santa_model" name="santa_model" value={data.settings.santa_model}>
						{#each data.models as model}<option value={model.id}>{model.label}</option>{/each}
					</select>
				</div>
				<div class="field">
					<label for="santa_effort">Effort</label>
					<select id="santa_effort" name="santa_effort" value={data.settings.santa_effort}>
						<option value="low">Low (fastest and cheapest)</option>
						<option value="medium">Medium</option>
						<option value="high">High (slowest, costs more)</option>
					</select>
				</div>
				<div class="form-grid two">
					<div class="field">
						<label for="santa_daily_cap">Messages per person, per day</label>
						<input id="santa_daily_cap" name="santa_daily_cap" type="number" min="1" max="500" value={data.settings.santa_daily_cap} />
					</div>
					<div class="field">
						<label for="ai_budget_usd">Season budget (US dollars)</label>
						<input id="ai_budget_usd" name="ai_budget_usd" type="number" min="0" max="1000" step="1" value={data.settings.ai_budget_usd} />
					</div>
				</div>
				<button class="btn btn-pine btn-sm">Save</button>
			</form>
			<hr class="divider" />
			<h3>Spending this season</h3>
			<p class="small">{usd(data.spend.total)} estimated from list prices, over {data.spend.calls} calls. Your Anthropic console has the exact figure.</p>
			{#if data.spend.byPurpose.length}
				<ul class="small spend">
					{#each data.spend.byPurpose as row}
						<li><span>{row.purpose.replace(/_/g, ' ')}</span><span>{row.calls} {row.calls === 1 ? 'call' : 'calls'}, {usd(row.cost)}</span></li>
					{/each}
				</ul>
			{/if}
		</section>

		<div class="stack">
			<section class="paper">
				<h2>Timing</h2>
				<form method="POST" action="?/relay" class="stack-sm form" use:enhance={stay}>
					<div class="form-grid two">
						<div class="field">
							<label for="relay_delay_min">Anonymous mail delay, at least (minutes)</label>
							<input id="relay_delay_min" name="relay_delay_min" type="number" min="0" max="1440" value={data.settings.relay_delay_min} />
						</div>
						<div class="field">
							<label for="relay_delay_max">At most (minutes)</label>
							<input id="relay_delay_max" name="relay_delay_max" type="number" min="0" max="2880" value={data.settings.relay_delay_max} />
						</div>
					</div>
					<p class="field-hint">A random delay means the time a question arrives doesn't show who was online.</p>
					<div class="field">
						<label for="reminder_hour">Planned reminders go out at (0 to 23)</label>
						<input id="reminder_hour" name="reminder_hour" type="number" min="0" max="23" value={data.settings.reminder_hour} />
					</div>
					<button class="btn btn-pine btn-sm">Save</button>
				</form>
			</section>

			<section class="paper">
				<h2>Backups</h2>
				<p class="small muted-ink intro">
					A snapshot is saved every day and the last 14 are kept. To restore one, you also need the <code>secret.key</code> file from your data folder, or the sealed pairings can't be read.
				</p>
				<form method="POST" action="?/backup" use:enhance>
					<button class="btn btn-quiet btn-sm">Back up now</button>
				</form>
				{#if data.backups.length}
					<ul class="small backups">
						{#each data.backups.slice(0, 6) as backup (backup.name)}
							<li>
								<a href="/admin/backup/{backup.name}" download>{relativeTime(backup.at)}</a>
								<span class="muted-ink">{kb(backup.size)}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>
	</div>
</main>

<style>
	.form {
		margin-top: 12px;
	}

	.intro {
		margin: 4px 0 12px;
	}

	.spend,
	.backups {
		list-style: none;
		padding: 0;
		margin: 8px 0 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.spend li,
	.backups li {
		display: flex;
		justify-content: space-between;
		gap: 10px;
	}
</style>
