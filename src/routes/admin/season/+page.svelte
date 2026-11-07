<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import WaxSeal from '$lib/components/WaxSeal.svelte';

	let { data, form } = $props();

	const season = $derived(data.season);
	const stay = () => async ({ update }: { update: (options?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
	let sealing = $state(false);
</script>

<main class="page stack">
	<div class="page-title">
		<h1>The draw</h1>
		<p>Set the rules, then seal the names. Once they're sealed, nobody can see the pairs in this app, including you.</p>
	</div>

	{#if form?.message}
		<p class="alert {form.ok ? 'alert-good' : 'alert-bad'}" role="status">{form.message}</p>
	{/if}

	{#if form?.pairs}
		<section class="paper emergency-result">
			<h2>Emergency reveal</h2>
			<p class="small">Only shown this once. The family has been told that you opened the list.</p>
			<ul>
				{#each form.pairs as pair}
					<li>{pair.giver} has {pair.receiver}</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if !season}
		<section class="paper stitched">
			<h2>Start a new season</h2>
			<form method="POST" action="?/create" class="stack-sm form" use:enhance>
				<div class="field">
					<label for="new-name">Season name</label>
					<input id="new-name" name="name" type="text" value="Christmas {new Date().getFullYear()}" required />
				</div>
				<button class="btn btn-wax">Start the season</button>
			</form>
		</section>
	{:else}
		{#if season.status === 'setup'}
			<section class="paper seal-card rise">
				<div class="seal-art"><WaxSeal size={84} /></div>
				<div class="grow">
					<h2>Ready to seal?</h2>
					{#if data.check?.ok}
						<p class="alert alert-good small">
							The rules work. Santa can find a fair draw for {data.participants?.length} people{#if data.check.arrangements !== null}, choosing from {data.check.arrangements.toLocaleString()} possible {data.check.arrangements === 1 ? 'arrangement' : 'arrangements'}{/if}.
						</p>
						{#if data.check.arrangements !== null && data.check.arrangements < 50}
							<p class="alert alert-warn small">That's very few, so the rules nearly decide the result by themselves. The family sees this number on the fairness page. Consider relaxing a rule.</p>
						{/if}
						<p class="small">Sealing draws everyone's names at once and tells the family they're ready to open. You'll have to use the repair options below to change anything afterward.</p>
						{#if sealing}
							<form method="POST" action="?/seal" class="row confirm" use:enhance>
								<button class="btn btn-wax">Yes, seal the names</button>
								<button class="btn btn-quiet" type="button" onclick={() => (sealing = false)}>Not yet</button>
							</form>
						{:else}
							<button class="btn btn-wax" onclick={() => (sealing = true)}>Seal the names</button>
						{/if}
					{:else}
						<p class="alert alert-bad small">{data.check?.reason}{data.check?.stuckNames?.length ? ` (${data.check.stuckNames.join(', ')})` : ''}</p>
						<p class="small">Change the rules or the people below, then try again.</p>
					{/if}
				</div>
			</section>

			<div class="grid-2">
				<section class="paper">
					<h2>The rules</h2>
					<form method="POST" action="?/rules" class="stack-sm form" use:enhance={stay}>
						<label class="check"><input type="checkbox" name="rule_guardian" checked={season.rule_guardian} /><span>Kids can't draw their parents, or parents their kids<small>Recommended. Parents see their kids' draws.</small></span></label>
						<label class="check"><input type="checkbox" name="rule_household" checked={season.rule_household} /><span>Nobody draws someone in their own household</span></label>
						<label class="check"><input type="checkbox" name="rule_no_repeat" checked={season.rule_no_repeat} /><span>Nobody draws the same person as last season</span></label>
						<label class="check"><input type="checkbox" name="rule_no_reciprocal" checked={season.rule_no_reciprocal} /><span>Two people can't draw each other</span></label>
						<button class="btn btn-pine btn-sm">Save rules</button>
					</form>

					{#if data.check}
						<hr class="divider" />
						<h3>How many names each person can draw</h3>
						<p class="small muted-ink">This is the only thing the check shows. It never tests a real pairing you could see.</p>
						<ul class="options">
							{#each data.check.options as option (option.id)}
								<li>
									<span>{option.name}</span>
									<span class="chip {option.count < 2 ? 'chip-bad' : option.count < 4 ? 'chip-warn' : 'chip-good'}">{option.count}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</section>

				<div class="stack">
					<section class="paper">
						<h2>Who's in this year</h2>
						<form method="POST" action="?/participants" class="stack-sm form" use:enhance={stay}>
							<div class="columns">
								{#each data.people as person (person.id)}
									<label class="check"><input type="checkbox" name="people" value={person.id} checked={data.participants?.includes(person.id)} /> {person.name}</label>
								{/each}
							</div>
							<button class="btn btn-pine btn-sm">Save</button>
						</form>
					</section>

					<section class="paper">
						<h2>Custom rules</h2>
						<p class="small muted-ink">For anything else, such as "these two just swapped gifts at the wedding".</p>
						{#if data.pairRules?.length}
							<ul class="pair-rules">
								{#each data.pairRules as rule (rule.id)}
									<li>
										<span>{rule.giver_name} {rule.both_ways ? 'and' : "can't draw"} {rule.receiver_name}{rule.both_ways ? " can't draw each other" : ''}{rule.note ? ` (${rule.note})` : ''}</span>
										<form method="POST" action="?/removePair" use:enhance>
											<input type="hidden" name="id" value={rule.id} />
											<button class="btn-link small">Remove</button>
										</form>
									</li>
								{/each}
							</ul>
						{/if}
						<form method="POST" action="?/addPair" class="stack-sm form" use:enhance>
							<div class="form-grid two">
								<div class="field">
									<label for="giver">This person</label>
									<select id="giver" name="giver" required>
										<option value="">Choose</option>
										{#each data.people as person (person.id)}<option value={person.id}>{person.name}</option>{/each}
									</select>
								</div>
								<div class="field">
									<label for="receiver">can't draw</label>
									<select id="receiver" name="receiver" required>
										<option value="">Choose</option>
										{#each data.people as person (person.id)}<option value={person.id}>{person.name}</option>{/each}
									</select>
								</div>
							</div>
							<label class="check"><input type="checkbox" name="both_ways" checked /> And the other way around</label>
							<div class="field">
								<label for="note">Why (optional)</label>
								<input id="note" name="note" type="text" />
							</div>
							<button class="btn btn-pine btn-sm">Add rule</button>
						</form>
					</section>
				</div>
			</div>
		{:else}
			<section class="paper seal-card rise">
				<div class="seal-art"><WaxSeal size={84} /></div>
				<div class="grow">
					<h2>{season.status === 'sealed' ? 'The names are sealed' : season.status === 'revealed' ? 'The results are published' : 'This season is archived'}</h2>
					{#if data.progress}<p>{data.progress.revealed} of {data.progress.total} people have opened their names.</p>{/if}
					{#if data.commitments?.length}
						<p class="small muted-ink">Published fingerprint:</p>
						<code class="hash">{data.commitments.at(-1)?.hash}</code>
					{/if}
				</div>
			</section>

			{#if season.status === 'sealed'}
				<section class="paper stitched">
					<h2>Publish the big reveal</h2>
					<p class="small">After the gifts are opened, this shows everyone who had who, and lets them check that the seal wasn't broken. It can't be undone.</p>
					<form method="POST" action="?/publish" class="form" use:enhance={({ cancel }) => {
						if (!confirm('Show the whole family who had who? This cannot be undone.')) cancel();
					}}>
						<button class="btn btn-gold"><Icon name="sparkle" size={18} /> Publish the reveal</button>
					</form>
				</section>

				<div class="grid-2">
					<section class="paper">
						<h2>Someone dropped out or joined</h2>
						<p class="small muted-ink">Santa changes as few names as possible. Only the people affected are asked to draw again. You won't see who that was.</p>
						<form method="POST" action="?/remove" class="stack-sm form" use:enhance={({ cancel }) => {
							if (!confirm('Remove this person from the draw?')) cancel();
						}}>
							<div class="field">
								<label for="remove-person">Remove from the draw</label>
								<select id="remove-person" name="person" required>
									<option value="">Choose</option>
									{#each (data.inDraw ?? []).filter((p) => p.included) as person (person.id)}<option value={person.id}>{person.name}</option>{/each}
								</select>
							</div>
							<button class="btn btn-quiet btn-sm">Remove them</button>
						</form>
						<hr class="divider" />
						<form method="POST" action="?/addLate" class="stack-sm" use:enhance>
							<div class="field">
								<label for="add-person">Add to the draw</label>
								<select id="add-person" name="person" required>
									<option value="">Choose</option>
									{#each (data.inDraw ?? []).filter((p) => !p.included) as person (person.id)}<option value={person.id}>{person.name}</option>{/each}
								</select>
							</div>
							<button class="btn btn-quiet btn-sm">Add them</button>
						</form>
					</section>

					<section class="paper danger">
						<h2>Last resorts</h2>
						<details>
							<summary>Redraw everyone</summary>
							<p class="small">Replaces every name and clears everyone's gift tracking and open questions. The whole family sees your reason.</p>
							<form method="POST" action="?/redraw" class="stack-sm form" use:enhance>
								<div class="field">
									<label for="redraw-reason">Reason</label>
									<input id="redraw-reason" name="reason" type="text" required />
								</div>
								<div class="form-grid two">
									<div class="field">
										<label for="redraw-remove">Also remove (optional)</label>
										<select id="redraw-remove" name="remove_person">
											<option value="">Nobody</option>
											{#each (data.inDraw ?? []).filter((p) => p.included) as person (person.id)}<option value={person.id}>{person.name}</option>{/each}
										</select>
									</div>
									<div class="field">
										<label for="redraw-add">Also add (optional)</label>
										<select id="redraw-add" name="add_person">
											<option value="">Nobody</option>
											{#each (data.inDraw ?? []).filter((p) => !p.included) as person (person.id)}<option value={person.id}>{person.name}</option>{/each}
										</select>
									</div>
								</div>
								<div class="field">
									<label for="redraw-confirm">Type REDRAW to confirm</label>
									<input id="redraw-confirm" name="confirm" type="text" autocomplete="off" required />
								</div>
								<button class="btn btn-wax btn-sm">Redraw everyone</button>
							</form>
						</details>
						<details>
							<summary>Emergency reveal</summary>
							<p class="small">Shows you all the pairs once. <strong>Everyone in the family is told immediately, with your reason,</strong> and it's recorded on the fairness page for good.</p>
							<form method="POST" action="?/emergency" class="stack-sm form" use:enhance>
								<div class="field">
									<label for="emergency-reason">Reason</label>
									<input id="emergency-reason" name="reason" type="text" required />
								</div>
								<div class="field">
									<label for="emergency-confirm">Type I UNDERSTAND to confirm</label>
									<input id="emergency-confirm" name="confirm" type="text" autocomplete="off" required />
								</div>
								<button class="btn btn-wax btn-sm">Open Santa's list</button>
							</form>
						</details>
					</section>
				</div>
			{/if}

			{#if season.status === 'revealed'}
				<section class="paper">
					<h2>Finish the season</h2>
					<p class="small">Archiving keeps this year's results for the "no repeats" rule and clears the way for next year.</p>
					<form method="POST" action="?/archive" class="form" use:enhance={({ cancel }) => {
						if (!confirm('Archive this season?')) cancel();
					}}>
						<button class="btn btn-pine">Archive the season</button>
					</form>
				</section>
			{/if}
		{/if}

		<section class="paper">
			<h2>Season details</h2>
			<form method="POST" action="?/details" class="stack-sm form" use:enhance={stay}>
				<div class="form-grid two">
					<div class="field">
						<label for="name">Season name</label>
						<input id="name" name="name" type="text" value={season.name} required />
					</div>
					<div class="field">
						<label for="spend_limit">Spending limit</label>
						<input id="spend_limit" name="spend_limit" type="text" value={season.spend_limit} placeholder="$50" />
					</div>
				</div>
				<div class="field">
					<label for="draw_opens">When can people open their names? (optional)</label>
					<input id="draw_opens" name="draw_opens" type="datetime-local" value={season.draw_opens_input} />
					<span class="field-hint">Leave this empty to allow it as soon as the names are sealed. Time is in {data.timeZone}.</span>
				</div>
				<div class="field">
					<label for="house_rules">House rules, one per line</label>
					<textarea id="house_rules" name="house_rules" rows="5">{season.house_rules}</textarea>
					<span class="field-hint">Santa uses these to answer questions, and the family can read them.</span>
				</div>
				<button class="btn btn-pine btn-sm">Save</button>
			</form>
		</section>
	{/if}

	{#if data.pastSeasons?.length}
		<section class="paper">
			<h2>Past seasons</h2>
			<ul class="past">
				{#each data.pastSeasons as past (past.id)}
					<li>{past.name} <span class="chip">{past.status}</span></li>
				{/each}
			</ul>
		</section>
	{/if}
</main>

<style>
	.form {
		margin-top: 12px;
	}

	.seal-card {
		display: flex;
		gap: 18px;
		align-items: flex-start;
		flex-wrap: wrap;
	}

	.seal-card .grow {
		display: flex;
		flex-direction: column;
		gap: 10px;
		align-items: flex-start;
		min-width: min(100%, 240px);
		flex: 1;
	}

	.confirm {
		margin-top: 2px;
	}

	.options {
		list-style: none;
		margin: 10px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.options li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}

	.columns {
		display: grid;
		gap: 7px;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr));
	}

	.pair-rules {
		list-style: none;
		padding: 0;
		margin: 10px 0 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.pair-rules li {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		align-items: baseline;
	}

	.hash {
		display: block;
		max-width: 100%;
		font-size: 0.78rem;
		word-break: break-all;
		padding: 8px 10px;
		border-radius: 8px;
		background: var(--night-900);
		color: var(--candle-400);
	}

	.danger details {
		margin-top: 12px;
	}

	.danger summary {
		cursor: pointer;
		font-weight: 800;
		color: var(--cran-700);
	}

	.emergency-result ul {
		margin: 10px 0 0;
		padding-left: 20px;
	}

	.past {
		list-style: none;
		padding: 0;
		margin: 8px 0 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
</style>
