<script lang="ts">
	import Icon from './Icon.svelte';

	let { text, label = 'Copy' }: { text: string; label?: string } = $props();
	let copied = $state(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			// Older phones and plain http pages have no clipboard API.
			const area = document.createElement('textarea');
			area.value = text;
			area.style.position = 'fixed';
			area.style.opacity = '0';
			document.body.append(area);
			area.select();
			document.execCommand('copy');
			area.remove();
		}
		copied = true;
		setTimeout(() => (copied = false), 1800);
	}
</script>

<button class="btn btn-pine btn-sm" type="button" onclick={copy}>
	<Icon name={copied ? 'check' : 'copy'} size={16} />
	{copied ? 'Copied!' : label}
</button>
