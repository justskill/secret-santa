<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from './Icon.svelte';
	import Ornament from './Ornament.svelte';

	const viewer = $derived(page.data.viewer!);
	const path = $derived(page.url.pathname);

	const tabs = $derived([
		{ href: '/', label: 'Home', icon: 'home', badge: 0 },
		{ href: '/my-list', label: viewer.helping ? `${viewer.profile.firstName}'s list` : 'My list', icon: 'list', badge: 0 },
		{ href: '/santa', label: 'Santa', icon: 'hat', badge: 0, feature: true },
		{ href: viewer.drawReady ? '/draw' : '/my-person', label: 'My person', icon: 'gift', badge: viewer.drawReady ? 1 : 0 },
		{ href: '/mail', label: 'Mail', icon: 'mail', badge: viewer.badges.mail }
	]);

	function isActive(href: string): boolean {
		return href === '/' ? path === '/' : path.startsWith(href);
	}

	let menuOpen = $state(false);
	let menu = $state<HTMLElement>();

	afterNavigate(() => {
		menuOpen = false;
	});

	function closeIfOutside(event: MouseEvent) {
		if (menuOpen && menu && !menu.contains(event.target as Node)) menuOpen = false;
	}

	function closeOnEscape(event: KeyboardEvent) {
		if (event.key === 'Escape') menuOpen = false;
	}
</script>

<svelte:window onclick={closeIfOutside} onkeydown={closeOnEscape} />

<header class="topbar">
	<a class="wordmark" href="/" aria-label="Secret Santa home">
		<span class="mark">Secret Santa</span>
		<span class="family">{page.data.familyName}</span>
	</a>

	<nav class="desktop-tabs" aria-label="Main">
		{#each tabs as tab (tab.href)}
			<a class="desktop-tab" class:active={isActive(tab.href)} href={tab.href} aria-current={isActive(tab.href) ? 'page' : undefined}>
				{tab.label}
				{#if tab.badge}<span class="badge">{tab.badge}</span>{/if}
			</a>
		{/each}
	</nav>

	<div class="actions">
		{#if viewer.account.isAdmin}
			<a class="icon-btn" href="/admin" aria-label="Admin"><Icon name="cog" /></a>
		{/if}
		<a class="icon-btn" href="/notices" aria-label="Notices, {viewer.badges.notices} unread">
			<Icon name="bell" />
			{#if viewer.badges.notices}<span class="badge pin">{viewer.badges.notices}</span>{/if}
		</a>
		<details class="menu" bind:open={menuOpen} bind:this={menu}>
			<summary class="profile-chip" aria-label="Menu for {viewer.profile.firstName}">
				<Ornament name={viewer.profile.name} color={viewer.profile.color} photo={viewer.profile.photo} size={28} label={false} />
				<span class="chip-name">{viewer.profile.firstName}</span>
			</summary>
			<div class="menu-panel">
				{#if viewer.wards.length}
					<a href="/profiles"><Icon name="users" size={18} /> Switch profile</a>
				{/if}
				<a href="/account"><Icon name="user" size={18} /> Your account</a>
				{#if viewer.account.isAdmin}
					<a href="/admin"><Icon name="cog" size={18} /> Head Elf's Office</a>
				{/if}
				<form method="POST" action="/logout">
					<button><Icon name="logout" size={18} /> Sign out</button>
				</form>
			</div>
		</details>
	</div>
</header>

{#if viewer.helping}
	<div class="helping" role="status">
		<span>You're helping <strong>{viewer.profile.firstName}</strong>. Everything here is {viewer.profile.firstName}'s.</span>
		<a href="/profiles">Switch</a>
	</div>
{/if}

<nav class="bottom-tabs" aria-label="Main">
	{#each tabs as tab (tab.href)}
		<a class="tab" class:active={isActive(tab.href)} class:feature={tab.feature} href={tab.href} aria-current={isActive(tab.href) ? 'page' : undefined}>
			<span class="tab-icon">
				<Icon name={tab.icon} size={tab.feature ? 26 : 23} />
				{#if tab.badge}<span class="badge pin">{tab.badge}</span>{/if}
			</span>
			<span class="tab-label">{tab.label}</span>
		</a>
	{/each}
</nav>

<style>
	.topbar {
		position: sticky;
		top: 0;
		z-index: 20;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 10px 16px;
		padding-top: calc(10px + env(safe-area-inset-top, 0px));
		background: linear-gradient(180deg, rgba(6, 16, 28, 0.98), rgba(6, 16, 28, 0.92));
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
	}

	.wordmark {
		display: flex;
		flex-direction: column;
		text-decoration: none;
		min-width: 0;
		line-height: 1.1;
	}

	.mark {
		font-family: var(--font-display);
		font-variation-settings: 'SOFT' 100, 'WONK' 1;
		font-weight: 700;
		font-size: 1.3rem;
		color: var(--candle-400);
		white-space: nowrap;
	}

	.family {
		font-size: 0.72rem;
		color: var(--mist);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 44vw;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: none;
	}

	.icon-btn {
		position: relative;
		display: grid;
		place-items: center;
		width: 42px;
		height: 42px;
		border-radius: 50%;
		color: var(--snow);
		text-decoration: none;
		transition: background 0.15s ease;
	}

	.icon-btn:hover {
		background: rgba(255, 255, 255, 0.12);
	}

	.badge.pin {
		position: absolute;
		top: 1px;
		right: -1px;
	}

	.menu {
		position: relative;
	}

	.profile-chip {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 3px 12px 3px 6px;
		margin-left: 2px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.1);
		font-weight: 800;
		font-size: 0.92rem;
		color: var(--snow);
		max-width: 150px;
		cursor: pointer;
		list-style: none;
	}

	.profile-chip::-webkit-details-marker {
		display: none;
	}

	.menu[open] .profile-chip {
		background: rgba(255, 255, 255, 0.2);
	}

	.menu-panel {
		position: absolute;
		top: calc(100% + 8px);
		right: 0;
		z-index: 30;
		min-width: 210px;
		padding: 6px;
		border-radius: 14px;
		background-color: var(--paper-100);
		background-image: var(--paper-grain);
		box-shadow: var(--shadow-card);
	}

	.menu-panel a,
	.menu-panel button {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 10px 12px;
		border: 0;
		border-radius: 10px;
		background: none;
		color: var(--ink-900);
		font-weight: 700;
		font-size: 0.97rem;
		text-align: left;
		text-decoration: none;
		cursor: pointer;
	}

	.menu-panel a:hover,
	.menu-panel button:hover {
		background: var(--paper-200);
	}

	.chip-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.helping {
		position: relative;
		z-index: 15;
		display: flex;
		justify-content: center;
		gap: 12px;
		flex-wrap: wrap;
		padding: 7px 16px;
		font-size: 0.9rem;
		text-align: center;
		background: linear-gradient(90deg, var(--candle-600), var(--candle-500));
		color: #2d1d05;
		font-weight: 600;
	}

	.helping a {
		font-weight: 900;
		color: #2d1d05;
	}

	.desktop-tabs {
		display: none;
	}

	.bottom-tabs {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 20;
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		align-items: end;
		padding: 6px 4px calc(6px + var(--safe-bottom));
		background: linear-gradient(180deg, rgba(10, 24, 40, 0.92), rgba(6, 16, 28, 0.98));
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		border-top: 1px solid rgba(255, 255, 255, 0.1);
	}

	.tab {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 4px 2px;
		color: var(--mist);
		text-decoration: none;
		font-size: 0.72rem;
		font-weight: 800;
		min-width: 0;
	}

	.tab-label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}

	.tab-icon {
		position: relative;
		display: grid;
		place-items: center;
		width: 34px;
		height: 30px;
	}

	.tab.active {
		color: var(--candle-400);
	}

	.tab.feature .tab-icon {
		width: 54px;
		height: 54px;
		margin-top: -24px;
		border-radius: 50%;
		color: #fff4dc;
		background: radial-gradient(120% 140% at 30% 15%, var(--cran-500), var(--cran-700) 60%, var(--cran-800));
		box-shadow: 0 0 0 3px rgba(6, 16, 28, 0.9), 0 8px 18px -4px rgba(125, 21, 40, 0.9);
	}

	.tab.feature.active .tab-icon {
		box-shadow: 0 0 0 3px var(--candle-400), 0 8px 18px -4px rgba(125, 21, 40, 0.9);
	}

	@media (min-width: 860px) {
		.bottom-tabs {
			display: none;
		}

		.desktop-tabs {
			display: flex;
			gap: 4px;
			flex: 1;
			justify-content: center;
		}

		.desktop-tab {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			padding: 8px 15px;
			border-radius: 999px;
			text-decoration: none;
			color: var(--mist);
			font-weight: 800;
			font-size: 0.96rem;
			transition: background 0.15s ease, color 0.15s ease;
		}

		.desktop-tab:hover {
			color: var(--snow);
			background: rgba(255, 255, 255, 0.08);
		}

		.desktop-tab.active {
			color: #2d1d05;
			background: linear-gradient(170deg, var(--candle-200), var(--candle-500));
		}

		.family {
			max-width: 230px;
		}
	}
</style>
