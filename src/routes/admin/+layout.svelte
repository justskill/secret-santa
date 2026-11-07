<script lang="ts">
	import { page } from '$app/state';
	import Icon from '$lib/components/Icon.svelte';

	let { children, data } = $props();

	const tabs = [
		{ href: '/admin', label: 'Overview', icon: 'home' },
		{ href: '/admin/people', label: 'People', icon: 'users' },
		{ href: '/admin/season', label: 'The draw', icon: 'gift' },
		{ href: '/admin/countdowns', label: 'Dates', icon: 'clock' },
		{ href: '/admin/reminders', label: 'Reminders', icon: 'bell' },
		{ href: '/admin/notices', label: 'Announce', icon: 'mail' },
		{ href: '/admin/settings', label: 'Settings', icon: 'cog' }
	];

	function isActive(href: string): boolean {
		return href === '/admin' ? page.url.pathname === '/admin' : page.url.pathname.startsWith(href);
	}
</script>

<svelte:head>
	<title>Head Elf | Secret Santa</title>
</svelte:head>

<header class="bar">
	<div class="title">
		<span class="mark">Head Elf's Office</span>
		<span class="family">{data.familyName}</span>
	</div>
	<div class="row bar-actions">
		<a class="btn btn-sm btn-gold" href="/"><Icon name="back" size={16} /> Family portal</a>
		<form method="POST" action="/logout">
			<button class="signout" aria-label="Sign out"><Icon name="logout" size={20} /></button>
		</form>
	</div>
</header>

<nav class="tabs" aria-label="Admin">
	{#each tabs as tab (tab.href)}
		<a class="tab" class:active={isActive(tab.href)} href={tab.href} aria-current={isActive(tab.href) ? 'page' : undefined}>
			<Icon name={tab.icon} size={18} />
			{tab.label}
		</a>
	{/each}
</nav>

<div class="admin">
	{@render children()}
</div>

<style>
	.bar {
		position: relative;
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 16px;
		background: rgba(6, 16, 28, 0.9);
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
	}

	.bar-actions {
		gap: 6px;
		flex-wrap: nowrap;
		flex: none;
	}

	.signout {
		display: grid;
		place-items: center;
		width: 38px;
		height: 38px;
		border: 0;
		border-radius: 50%;
		background: none;
		color: var(--snow);
		cursor: pointer;
	}

	.signout:hover {
		background: rgba(255, 255, 255, 0.12);
	}

	.title {
		display: flex;
		flex-direction: column;
		min-width: 0;
		line-height: 1.15;
	}

	.mark {
		font-family: var(--font-display);
		font-variation-settings: 'SOFT' 100, 'WONK' 1;
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--candle-400);
	}

	.family {
		font-size: 0.74rem;
		color: var(--mist);
	}

	.tabs {
		position: sticky;
		top: 0;
		z-index: 11;
		display: flex;
		gap: 4px;
		padding: 8px 12px;
		overflow-x: auto;
		background: rgba(11, 26, 43, 0.92);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
		scrollbar-width: none;
	}

	.tab {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 13px;
		border-radius: 999px;
		text-decoration: none;
		font-weight: 800;
		font-size: 0.92rem;
		color: var(--mist);
		white-space: nowrap;
	}

	.tab:hover {
		background: rgba(255, 255, 255, 0.08);
		color: var(--snow);
	}

	.tab.active {
		background: linear-gradient(170deg, var(--candle-200), var(--candle-500));
		color: #2d1d05;
	}

	.admin {
		position: relative;
		z-index: 2;
	}

	.admin :global(.page) {
		padding-bottom: 60px;
	}
</style>
