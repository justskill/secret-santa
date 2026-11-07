<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import Ornament from '$lib/components/Ornament.svelte';
	import RelayComposer from '$lib/components/RelayComposer.svelte';
	import SantaFace from '$lib/components/SantaFace.svelte';
	import WishCard from '$lib/components/WishCard.svelte';

	let { data, form } = $props();

	const helping = $derived(data.viewer?.helping ?? false);
	const me = $derived(data.viewer?.profile.firstName ?? '');

	let slipGift = $state('');
	let slipPrice = $state('');
	let slipLink = $state('');
	let slipWhy = $state('');
	let question = $state('');
	let questionRoute = $state<'person' | 'helpers'>('person');
	let showLog = $state(false);

	const APPROVAL: Record<string, { label: string; className: string; icon: string }> = {
		waiting: { label: 'Waiting for an answer', className: 'chip-warn', icon: 'clock' },
		approved: { label: 'Approved', className: 'chip-good', icon: 'check' },
		declined: { label: 'Not approved', className: 'chip-bad', icon: 'x' },
		none: { label: 'No permission slip', className: 'chip-bad', icon: 'x' }
	};
</script>

<svelte:head>
	<title>My person | Secret Santa</title>
</svelte:head>

<main class="page stack">
	{#if data.state === 'no_season'}
		<section class="paper center-note">
			<SantaFace size={80} />
			<p>The workshop isn't open yet. Check back soon!</p>
		</section>
	{:else if data.state === 'not_drawn'}
		<section class="paper stitched center-note rise">
			<SantaFace size={90} />
			<h1>Who could it be?</h1>
			{#if data.drawOpen}
				<p>{helping ? `${me} hasn't` : "You haven't"} opened the name yet, so Santa isn't saying.</p>
				<a class="btn btn-wax" href="/draw">Open the name</a>
			{:else}
				<p>The names aren't ready yet. You'll get a notice when it's time to draw.</p>
				<a class="btn btn-gold" href="/my-list">Work on {helping ? `${me}'s` : 'your'} wish list</a>
			{/if}
		</section>
	{:else if data.recipient}
		{@const person = data.recipient}
		<header class="person-head rise">
			<Ornament name={person.name} color={person.color} photo={person.photo} size={88} label={false} />
			<div>
				<p class="eyebrow">{helping ? `${me} is shopping for` : "You're shopping for"}</p>
				<h1>{person.name}</h1>
				<div class="row head-chips">
					{#if data.meta?.ready_at}
						<span class="chip chip-good"><Icon name="check" size={14} /> List is ready</span>
					{:else}
						<span class="chip chip-warn"><Icon name="clock" size={14} /> List is still in progress</span>
					{/if}
					{#if data.spendLimit}<span class="chip chip-night">Spending limit: {data.spendLimit}</span>{/if}
				</div>
			</div>
		</header>

		{#if form?.message}
			<p class="alert {form.kind === 'bad' ? 'alert-bad' : 'alert-good'}" role="status">{form.message}</p>
		{/if}

		<div class="grid-2 wide-left">
			<section class="paper stitched">
				<h2>{person.firstName}'s wish list</h2>
				{#if data.meta?.intro_note}<p class="intro hand">"{data.meta.intro_note}"</p>{/if}
				{#if data.items?.length}
					<div class="items">
						{#each data.items as item (item.id)}
							{@const bought = data.boughtItemIds?.includes(item.id)}
							<WishCard {item} muted={bought}>
								<form method="POST" action="?/toggleItem" use:enhance={() => async ({ update }) => update({ reset: false })}>
									<input type="hidden" name="item" value={item.id} />
									<input type="hidden" name="bought" value={bought ? '0' : '1'} />
									{#if bought}
										<button class="btn btn-sm bought"><Icon name="check" size={16} /> Bought (undo)</button>
									{:else}
										<button class="btn btn-sm btn-pine">I bought this</button>
									{/if}
								</form>
							</WishCard>
						{/each}
					</div>
				{:else if !data.meta?.amazon_url}
					<p class="empty">{person.firstName} hasn't added anything yet. Santa will let you know when the list is ready.</p>
				{/if}
				{#if data.meta?.amazon_url}
					<hr class="divider" />
					<a class="btn btn-gold" href={data.meta.amazon_url} target="_blank" rel="noopener noreferrer">
						Open {person.firstName}'s Amazon list <Icon name="external" size={16} />
					</a>
				{/if}
			</section>

			<div class="stack">
				{#if data.guidance?.notes || data.guidance?.helper_notes}
					<section class="paper">
						<h2>Shopping notes</h2>
						{#if data.guidance.notes}<p class="note-text">{data.guidance.notes}</p>{/if}
						{#if data.guidance.helper_notes}
							<div class="whisper">
								<p class="eyebrow">Whispered by {person.firstName}'s family</p>
								<p class="note-text">{data.guidance.helper_notes}</p>
							</div>
						{/if}
					</section>
				{/if}

				<section class="paper slip">
					<div class="slip-head">
						<Icon name="scroll" size={26} />
						<h2>Thinking of something not on the list?</h2>
					</div>
					<p class="small">
						Family rule: off-list gifts need a permission slip. Santa asks {person.kind === 'kid' ? `${person.firstName}'s parents` : `${person.firstName}'s spouse`},
						and they never find out it was {helping ? me : 'you'} asking.
					</p>
					<RelayComposer
						action="?/sendSlip"
						purpose="permission_slip"
						rewordLabel="Let Santa write the slip"
						sendLabel="Send the slip"
						disabled={!slipGift.trim()}
						extra={{ gift: slipGift, price: slipPrice, gift_url: slipLink }}
						buildText={() =>
							`Is it OK to give ${person.firstName} this gift, which is not on the wish list: ${slipGift}${slipPrice ? ` (about ${slipPrice})` : ''}.${slipWhy ? ` Reason: ${slipWhy}` : ''}`}
						onsent={() => {
							slipGift = slipPrice = slipLink = slipWhy = '';
						}}
					>
						{#snippet fields()}
							<div class="field">
								<label for="slip-gift">What's the gift?</label>
								<input id="slip-gift" type="text" bind:value={slipGift} placeholder="A pair of hiking boots" />
								<span class="field-hint">Shown exactly as you type it, so leave out anything that gives you away.</span>
							</div>
							<div class="form-grid two">
								<div class="field">
									<label for="slip-price">About how much?</label>
									<input id="slip-price" type="text" bind:value={slipPrice} />
								</div>
								<div class="field">
									<label for="slip-link">Link (optional)</label>
									<input id="slip-link" type="url" bind:value={slipLink} placeholder="https://..." />
								</div>
							</div>
							<div class="field">
								<label for="slip-why">Why this gift? (optional)</label>
								<input id="slip-why" type="text" bind:value={slipWhy} />
							</div>
						{/snippet}
					</RelayComposer>
				</section>

				{#if data.offListGifts?.length}
					<section class="paper">
						<h2>Off-list gifts</h2>
						<ul class="gifts">
							{#each data.offListGifts as gift (gift.id)}
								{@const status = APPROVAL[gift.approval] ?? APPROVAL.none}
								<li>
									<div class="grow">
										<strong>{gift.title}</strong>
										{#if gift.price_text}<span class="small muted-ink"> {gift.price_text}</span>{/if}
										<div class="row gift-status">
											<span class="chip {status.className}"><Icon name={status.icon} size={13} /> {status.label}</span>
											{#if gift.bought}<span class="chip chip-good">Bought</span>{/if}
										</div>
									</div>
									<div class="row gift-actions">
										{#if gift.approval === 'approved' || gift.approval === 'none'}
											<form method="POST" action="?/giftBought" use:enhance>
												<input type="hidden" name="gift" value={gift.id} />
												<input type="hidden" name="bought" value={gift.bought ? '0' : '1'} />
												<button class="btn btn-sm {gift.bought ? 'btn-quiet' : 'btn-pine'}">{gift.bought ? 'Undo' : 'I bought it'}</button>
											</form>
										{/if}
										{#if !gift.bought}
											<form method="POST" action="?/removeGift" use:enhance>
												<input type="hidden" name="gift" value={gift.id} />
												<button class="btn-link small">Remove</button>
											</form>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
					</section>
				{/if}

				<section class="paper">
					<h2>Ask an anonymous question</h2>
					<p class="small muted-ink ask-intro">Santa rewords it so nobody can tell who wrote it.</p>
					<RelayComposer
						action="?/sendQuestion"
						purpose={questionRoute === 'person' ? 'question_to_person' : 'question_to_helper'}
						disabled={!question.trim()}
						extra={{ route: questionRoute }}
						buildText={() => question}
						onsent={() => (question = '')}
					>
						{#snippet fields()}
							<div class="field">
								<label for="ask">What do you want to know?</label>
								<textarea id="ask" rows="3" bind:value={question} placeholder="What size shoes do they wear?"></textarea>
							</div>
							{#if data.hasHelper}
								<fieldset class="route">
									<legend class="field-label">Who should Santa ask?</legend>
									<label class="check">
										<input type="radio" name="route-choice" value="person" bind:group={questionRoute} />
										<span>{person.firstName} {person.kind === 'kid' ? '(through their parents)' : ''}</span>
									</label>
									<label class="check">
										<input type="radio" name="route-choice" value="helpers" bind:group={questionRoute} />
										<span>{person.kind === 'kid' ? `${person.firstName}'s parents, without ${person.firstName} knowing` : `${person.firstName}'s spouse, to keep the surprise`}</span>
									</label>
								</fieldset>
							{/if}
						{/snippet}
					</RelayComposer>
					{#if data.questions?.length}
						<p class="small answers"><a href="/mail">See your {data.questions.length === 1 ? 'question' : `${data.questions.length} questions`} in North Pole Mail</a></p>
					{/if}
				</section>

				<div class="frost log">
					{#if showLog}
						<form method="POST" action="?/logOffList" class="stack-sm" use:enhance={() => async ({ update }) => {
							await update();
							showLog = false;
						}}>
							<label class="field-label log-label" for="log-title">What did you buy?</label>
							<input id="log-title" name="title" type="text" required />
							<div class="row">
								<button class="btn btn-gold btn-sm">Log it</button>
								<button class="btn btn-quiet btn-sm" type="button" onclick={() => (showLog = false)}>Cancel</button>
							</div>
						</form>
					{:else}
						<p class="small">Already bought something off-list without asking?</p>
						<button class="confess" type="button" onclick={() => (showLog = true)}>Confess to Santa</button>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</main>

<style>
	.center-note {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 12px;
		padding: 36px 24px;
		max-width: 520px;
		margin: 6vh auto 0;
	}

	.center-note h1 {
		color: var(--pine-800);
	}

	.person-head {
		display: flex;
		align-items: center;
		gap: 16px;
		text-shadow: 0 1px 8px rgba(3, 9, 17, 0.85);
	}

	.head-chips {
		margin-top: 8px;
		gap: 6px;
	}

	.intro {
		color: var(--ink-700);
		margin-top: 6px;
	}

	.items {
		margin-top: 4px;
	}

	.bought {
		background: #d9f0e2;
		color: #125339;
	}

	.note-text {
		white-space: pre-line;
		margin-top: 6px;
	}

	.whisper {
		margin-top: 12px;
		padding: 12px 14px;
		border-radius: 12px;
		background: var(--paper-200);
	}

	.slip {
		background-color: #fff3d9;
		box-shadow: 0 0 0 2px var(--candle-500), var(--shadow-card);
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.slip-head {
		display: flex;
		align-items: center;
		gap: 10px;
		color: var(--cran-700);
	}

	.slip-head h2 {
		font-size: 1.25rem;
		color: var(--cran-700);
	}

	.gifts {
		list-style: none;
		margin: 8px 0 0;
		padding: 0;
	}

	.gifts li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 10px;
		padding: 12px 0;
		border-bottom: 1.5px dashed var(--paper-300);
	}

	.gifts li:last-child {
		border-bottom: 0;
	}

	.gift-status {
		margin-top: 5px;
		gap: 6px;
	}

	.gift-actions {
		gap: 12px;
	}

	.ask-intro {
		margin: 4px 0 10px;
	}

	.route {
		border: 0;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 7px;
	}

	.answers {
		margin-top: 12px;
	}

	.log {
		padding: 12px 16px;
		text-align: center;
		color: var(--snow);
	}

	.log-label {
		color: var(--snow);
	}

	.confess {
		background: none;
		border: 0;
		padding: 0;
		color: var(--candle-400);
		font-weight: 800;
		text-decoration: underline;
		cursor: pointer;
	}
</style>
