<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { jingle, setSoundEnabled, soundEnabled } from '$lib/client/sound';
	import Icon from '$lib/components/Icon.svelte';
	import Ornament from '$lib/components/Ornament.svelte';

	let { data, form } = $props();

	const viewer = $derived(data.viewer!);
	let sound = $state(false);
	let fileInput = $state<HTMLInputElement>();
	let photoForm = $state<HTMLFormElement>();
	let uploading = $state(false);

	onMount(() => {
		sound = soundEnabled();
	});

	/** Shrinks phone photos in the browser, so uploads stay quick and the server stays small. */
	async function shrink(file: File): Promise<File> {
		try {
			const bitmap = await createImageBitmap(file);
			const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
			const canvas = document.createElement('canvas');
			canvas.width = Math.round(bitmap.width * scale);
			canvas.height = Math.round(bitmap.height * scale);
			canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
			const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
			return blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : file;
		} catch {
			return file;
		}
	}

	async function onPick() {
		const file = fileInput?.files?.[0];
		if (!file || !fileInput || !photoForm) return;
		uploading = true;
		const small = await shrink(file);
		const transfer = new DataTransfer();
		transfer.items.add(small);
		fileInput.files = transfer.files;
		photoForm.requestSubmit();
	}

	function toggleSound() {
		sound = !sound;
		setSoundEnabled(sound);
		if (sound) jingle(0.3);
	}
</script>

<svelte:head>
	<title>Account | Secret Santa</title>
</svelte:head>

<main class="page narrow stack">
	<div class="page-title">
		<h1>{viewer.helping ? `${viewer.profile.firstName}'s photo` : 'Your account'}</h1>
	</div>

	<section class="paper photo">
		<Ornament name={viewer.profile.name} color={viewer.profile.color} photo={viewer.profile.photo} size={100} label={false} />
		<div class="grow">
			<h2>{viewer.profile.name}</h2>
			<p class="small muted">This photo appears in the draw and on family pages.</p>
			{#if form?.photoMessage}
				<p class="alert {form.photoOk ? 'alert-good' : 'alert-bad'} small msg" role="status">{form.photoMessage}</p>
			{/if}
			<form
				method="POST"
				action="?/photo"
				enctype="multipart/form-data"
				bind:this={photoForm}
				use:enhance={() =>
					async ({ update }) => {
						await update();
						uploading = false;
					}}
			>
				<label class="btn btn-pine btn-sm upload">
					<Icon name="camera" size={16} />
					{uploading ? 'Uploading...' : 'Choose a photo'}
					<input class="visually-hidden" bind:this={fileInput} type="file" name="photo" accept="image/*" onchange={onPick} />
				</label>
			</form>
			{#if viewer.profile.photo}
				<form method="POST" action="?/removePhoto" use:enhance>
					<button class="btn-link small">Remove photo</button>
				</form>
			{/if}
		</div>
	</section>

	<section class="paper row between">
		<div class="grow">
			<h2>Sounds</h2>
			<p class="small muted">Sleigh bells during the draw. Off unless you turn them on.</p>
		</div>
		<button class="btn btn-quiet" onclick={toggleSound} aria-pressed={sound}>
			<Icon name={sound ? 'sound' : 'mute'} size={18} /> {sound ? 'On' : 'Off'}
		</button>
	</section>

	{#if viewer.wards.length}
		<section class="paper row between">
			<div class="grow">
				<h2>Profiles</h2>
				<p class="small muted">Switch between yourself and your kids.</p>
			</div>
			<a class="btn btn-quiet" href="/profiles">Switch</a>
		</section>
	{/if}

	<section class="paper">
		<h2>Change your password</h2>
		<p class="small muted">Signed in as <strong>{data.username}</strong>.</p>
		<form method="POST" action="?/password" class="stack-sm pw" use:enhance>
			{#if form?.passwordMessage}
				<p class="alert {form.passwordOk ? 'alert-good' : 'alert-bad'} small" role="status">{form.passwordMessage}</p>
			{/if}
			<input type="hidden" name="username" autocomplete="username" value={data.username} />
			<div class="field">
				<label for="current">Current password</label>
				<input id="current" name="current" type="password" autocomplete="current-password" required />
			</div>
			<div class="field">
				<label for="next">New password</label>
				<input id="next" name="next" type="password" autocomplete="new-password" minlength={data.minLength} required />
			</div>
			<button class="btn btn-pine btn-sm">Change password</button>
		</form>
	</section>

	<form method="POST" action="/logout">
		<button class="btn btn-ghost signout"><Icon name="logout" size={18} /> Sign out</button>
	</form>
</main>

<style>
	.photo {
		display: flex;
		align-items: center;
		gap: 18px;
		flex-wrap: wrap;
	}

	.photo form {
		margin-top: 8px;
	}

	.msg {
		margin-top: 8px;
	}

	.upload {
		cursor: pointer;
	}

	.pw {
		margin-top: 12px;
	}

	.signout {
		color: var(--snow);
	}
</style>
