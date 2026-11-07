<script lang="ts">
	import { relativeTime } from '$lib/time';
	import Icon from './Icon.svelte';

	interface NoticeView {
		id: number;
		kind: string;
		title: string;
		body: string;
		link: string | null;
		created_at: string;
		read: number;
	}

	let { notice }: { notice: NoticeView } = $props();

	const ICONS: Record<string, string> = {
		mail: 'mail',
		draw: 'gift',
		deadline: 'clock',
		list: 'list',
		reminder: 'bell',
		alert: 'shield',
		party: 'sparkle',
		info: 'star'
	};
</script>

<li class="notice" class:unread={!notice.read}>
	<span class="icon"><Icon name={ICONS[notice.kind] ?? 'star'} size={18} /></span>
	<div class="grow">
		{#if notice.link}
			<a class="title" href={notice.link}>{notice.title}</a>
		{:else}
			<span class="title">{notice.title}</span>
		{/if}
		{#if notice.body}<p class="body">{notice.body}</p>{/if}
		<time datetime={notice.created_at}>{relativeTime(notice.created_at)}</time>
	</div>
</li>

<style>
	.notice {
		display: flex;
		gap: 12px;
		padding: 12px 0;
		border-bottom: 1.5px dashed var(--paper-300);
	}

	.notice:last-child {
		border-bottom: 0;
		padding-bottom: 0;
	}

	.icon {
		display: grid;
		place-items: center;
		flex: none;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		background: var(--paper-200);
		color: var(--pine-700);
	}

	.unread .icon {
		background: var(--cran-600);
		color: #fff4dc;
	}

	.title {
		display: block;
		font-weight: 800;
		color: var(--ink-900) !important;
		text-decoration: none;
		line-height: 1.3;
	}

	a.title:hover {
		text-decoration: underline;
	}

	.body {
		font-size: 0.93rem;
		color: var(--ink-700);
		line-height: 1.4;
		margin-top: 2px;
	}

	time {
		display: block;
		font-size: 0.8rem;
		color: var(--ink-500);
		margin-top: 2px;
	}
</style>
