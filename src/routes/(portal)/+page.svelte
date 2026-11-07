<script lang="ts">
	import { enhance } from '$app/forms';
	import FlipCountdown from '$lib/components/FlipCountdown.svelte';
	import GiftIcon from '$lib/components/GiftIcon.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import NoticeRow from '$lib/components/NoticeRow.svelte';
	import Ornament from '$lib/components/Ornament.svelte';
	import SantaFace from '$lib/components/SantaFace.svelte';
	import WaitingMail from '$lib/components/WaitingMail.svelte';
	import { formatDate } from '$lib/time';

	let { data } = $props();

	const doneCount = $derived(data.tasks.filter((task) => task.done).length);
	const nextTask = $derived(data.tasks.find((task) => !task.done && !task.blocked));
	const viewer = $derived(data.viewer!);

	// The other profiles this person looks after that need something, so a parent doesn't miss a kid.
	const others = $derived(
		[
			...(viewer.helping ? [{ ...viewer.account, ...viewer.accountNeeds }] : []),
			...viewer.wards.filter((ward) => ward.id !== viewer.profile.id)
		].filter((person) => person.drawReady || person.waiting > 0)
	);
</script>

<svelte:head>
	<title>Home | Secret Santa</title>
</svelte:head>

<main class="page stack">
	{#if viewer.drawReady}
		<a class="draw-hero rise" href="/draw">
			<GiftIcon size={112} />
			<div class="hero-text">
				<p class="eyebrow">The names are sealed</p>
				<h2>{viewer.helping ? `A name is ready for ${viewer.profile.firstName} to open` : 'Your name is ready to open'}</h2>
				<p class="hand">
					{viewer.helping
						? `Ho ho ho! Open this one together with ${viewer.profile.firstName}.`
						: `Ho ho ho, ${viewer.profile.firstName}! There's a name sealed inside, just for you.`}
				</p>
			</div>
			<span class="btn btn-gold hero-button">Open {viewer.helping ? 'the' : 'your'} name</span>
		</a>
	{:else}
		<section class="note rise">
			<SantaFace size={84} />
			<div class="note-body">
				<p class="hand">{data.greeting}</p>
				{#if nextTask}
					<a class="btn btn-gold btn-sm" href={nextTask.href}>{nextTask.action}</a>
				{:else}
					<a class="btn btn-gold btn-sm" href="/santa">Chat with Santa</a>
				{/if}
			</div>
		</section>
	{/if}

	{#if data.waiting.length}
		<WaitingMail items={data.waiting} />
	{/if}

	{#if others.length}
		<section class="others rise" aria-label="Others who need you">
			{#each others as person (person.id)}
				<form method="POST" action="/profiles?/switch" use:enhance>
					<input type="hidden" name="person" value={person.id} />
					<button class="other">
						<Ornament name={person.name} color={person.color} photo={person.photo} size={40} label={false} />
						<span class="other-text">
							<strong>{person.firstName}</strong>
							<span class="small">
								{[
									person.drawReady ? 'Name ready to open' : '',
									person.waiting ? `${person.waiting} ${person.waiting === 1 ? 'message needs' : 'messages need'} an answer` : ''
								]
									.filter(Boolean)
									.join(' and ')}
							</span>
						</span>
						<Icon name="chevron" size={18} />
					</button>
				</form>
			{/each}
		</section>
	{/if}

	{#if data.revealed}
		<a class="reveal-banner rise" href="/reveal">
			<Icon name="sparkle" size={26} />
			<span><strong>The big reveal is here!</strong> See who had who.</span>
			<Icon name="chevron" />
		</a>
	{/if}

	{#if data.lead}
		<div class="countdowns rise" class:solo={!data.countdowns.length}>
			<FlipCountdown
				target={data.lead.target_at}
				title={data.lead.title}
				subtitle={data.lead.subtitle}
				dateLabel={formatDate(data.lead.target_at, data.timeZone)}
				tone="wax"
			/>
			{#if data.countdowns.length}
				<div class="more-countdowns">
					{#each data.countdowns as countdown (countdown.id)}
						<FlipCountdown
							target={countdown.target_at}
							title={countdown.title}
							subtitle={countdown.subtitle}
							dateLabel={formatDate(countdown.target_at, data.timeZone)}
							size="small"
						/>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<div class="grid-2 wide-left">
		{#if data.tasks.length}
			<section class="paper stitched checklist">
				<div class="row between">
					<h2>{data.viewer?.helping ? `${data.viewer.profile.firstName}'s checklist` : 'Your checklist'}</h2>
					<span class="chip">{doneCount} of {data.tasks.length}</span>
				</div>
				<div class="candy" role="progressbar" aria-valuemin={0} aria-valuemax={data.tasks.length} aria-valuenow={doneCount}>
					<span style:width="{(doneCount / data.tasks.length) * 100}%"></span>
				</div>
				<ul>
					{#each data.tasks as task (task.key)}
						<li class:done={task.done} class:blocked={task.blocked}>
							<span class="tick" aria-hidden="true">
								{#if task.done}<Icon name="check" size={18} />{:else if task.blocked}<Icon name="lock" size={15} />{/if}
							</span>
							<div class="grow">
								<strong>{task.title}</strong>
								<p class="small muted">{task.detail}</p>
							</div>
							{#if !task.blocked}
								<a class="btn btn-sm {task.done ? 'btn-quiet' : 'btn-pine'}" href={task.href}>{task.action}</a>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section class="paper notices">
			<div class="row between">
				<h2>From the North Pole</h2>
				<a class="small" href="/notices">See all</a>
			</div>
			{#if data.notices.length}
				<ul class="notice-list">
					{#each data.notices as notice (notice.id)}
						<NoticeRow {notice} />
					{/each}
				</ul>
			{:else}
				<p class="empty">Nothing new from the workshop yet.</p>
			{/if}
		</section>
	</div>

	<section class="links">
		<a class="frost link-card" href="/fairness">
			<Icon name="shield" />
			<span><strong>How the draw stays fair</strong><small>The rules, and the seal you can check</small></span>
		</a>
		{#if !data.viewer?.helping}
			<a class="frost link-card" href="/helping">
				<Icon name="users" />
				<span><strong>People you help</strong><small>Shopping notes for your kids and spouse</small></span>
			</a>
		{/if}
		<a class="frost link-card" href="/account">
			<Icon name="user" />
			<span><strong>Your account</strong><small>Photo, password, and sign out</small></span>
		</a>
	</section>
</main>

<style>
	.note {
		display: flex;
		align-items: flex-start;
		gap: 14px;
	}

	.note-body {
		position: relative;
		flex: 1;
		min-width: 0;
		padding: 14px 18px 16px;
		background-color: var(--paper-100);
		background-image: var(--paper-grain);
		color: var(--ink-900);
		border-radius: 6px 20px 20px 20px;
		box-shadow: var(--shadow-card);
	}

	.note-body::before {
		content: '';
		position: absolute;
		left: -9px;
		top: 14px;
		border-style: solid;
		border-width: 8px 10px 8px 0;
		border-color: transparent var(--paper-100) transparent transparent;
	}

	.note-body .hand {
		font-size: clamp(1.5rem, 4.6vw, 1.95rem);
		color: var(--ink-900);
		margin-bottom: 10px;
	}

	.draw-hero {
		position: relative;
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 20px;
		padding: 22px 26px;
		border-radius: var(--radius-lg);
		text-decoration: none;
		color: #fff4dc;
		background: radial-gradient(130% 170% at 12% 10%, var(--cran-500), var(--cran-700) 55%, #4f0e1c);
		box-shadow: 0 0 0 2px var(--candle-500), var(--shadow-card);
		animation:
			rise-in 0.45s cubic-bezier(0.2, 0.7, 0.2, 1) both,
			hero-glow 2.4s ease-in-out infinite alternate;
		transition: transform 0.15s ease;
	}

	.draw-hero:hover {
		transform: translateY(-2px);
	}

	@keyframes hero-glow {
		from {
			box-shadow: 0 0 0 2px var(--candle-500), 0 0 22px -4px rgba(240, 195, 106, 0.35), var(--shadow-card);
		}
		to {
			box-shadow: 0 0 0 2px var(--candle-400), 0 0 60px 2px rgba(240, 195, 106, 0.6), var(--shadow-card);
		}
	}

	.hero-text h2 {
		font-size: clamp(1.6rem, 4.6vw, 2.3rem);
		color: #fff8e8;
		margin: 3px 0 4px;
	}

	.hero-text .eyebrow {
		color: var(--candle-200);
	}

	.hero-text .hand {
		font-size: clamp(1.25rem, 3.2vw, 1.5rem);
		color: var(--candle-200);
	}

	.hero-button {
		min-height: 58px;
		padding: 12px 30px;
		font-size: 1.15rem;
		white-space: nowrap;
	}

	@media (max-width: 720px) {
		.draw-hero {
			grid-template-columns: minmax(0, 1fr);
			justify-items: center;
			text-align: center;
			gap: 12px;
			padding: 22px 18px;
		}

		.hero-button {
			width: 100%;
		}
	}

	.others {
		display: grid;
		gap: 10px;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
	}

	.other {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 10px 14px;
		border-radius: var(--radius);
		border: 1.5px solid var(--candle-500);
		background: var(--frost-bg);
		color: var(--snow);
		text-align: left;
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.other:hover {
		background: var(--frost-bg-hover);
	}

	.other-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		line-height: 1.3;
	}

	.other-text .small {
		color: var(--candle-200);
	}

	.reveal-banner {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px 18px;
		border-radius: var(--radius);
		text-decoration: none;
		font-size: 1rem;
		box-shadow: var(--shadow-card);
	}

	.reveal-banner {
		color: #3b2708;
		background: linear-gradient(120deg, var(--candle-200), var(--candle-500));
	}

	.reveal-banner span {
		flex: 1;
		min-width: 0;
	}

	.countdowns {
		display: grid;
		gap: 14px;
		grid-template-columns: minmax(0, 1fr);
	}

	@media (min-width: 860px) {
		.countdowns:not(.solo) {
			grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
			align-items: stretch;
		}
		.countdowns > :global(.countdown) {
			display: flex;
			flex-direction: column;
			justify-content: center;
		}
	}

	.more-countdowns {
		display: grid;
		gap: 14px;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 290px), 1fr));
	}

	.checklist h2,
	.notices h2 {
		font-size: 1.3rem;
	}

	.candy {
		height: 12px;
		margin: 12px 0 8px;
		border-radius: 999px;
		background: var(--paper-200);
		overflow: hidden;
		box-shadow: inset 0 1px 3px rgba(42, 31, 22, 0.25);
	}

	.candy span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: repeating-linear-gradient(-45deg, var(--cran-600) 0 9px, #fff 9px 18px);
		transition: width 0.5s ease;
	}

	.checklist ul,
	.notice-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.checklist li {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 13px 0;
		border-bottom: 1.5px dashed var(--paper-300);
	}

	.checklist li:last-child {
		border-bottom: 0;
		padding-bottom: 2px;
	}

	.tick {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		flex: none;
		border: 2px solid var(--paper-300);
		color: #fff;
	}

	.done .tick {
		background: var(--pine-500);
		border-color: var(--pine-500);
	}

	.blocked .tick {
		color: var(--ink-500);
		background: var(--paper-200);
	}

	.blocked strong {
		color: var(--ink-500);
	}

	.checklist .muted {
		color: var(--ink-500);
		line-height: 1.35;
	}

	.links {
		display: grid;
		gap: 12px;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
	}

	.link-card {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px 16px;
		text-decoration: none;
		transition: transform 0.15s ease, background 0.15s ease;
	}

	.link-card:hover {
		transform: translateY(-2px);
		background: var(--frost-bg-hover);
	}

	.link-card span {
		display: flex;
		flex-direction: column;
		min-width: 0;
		line-height: 1.3;
	}

	.link-card small {
		color: var(--mist);
		font-size: 0.84rem;
	}
</style>
