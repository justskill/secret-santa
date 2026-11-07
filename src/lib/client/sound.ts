/**
 * Every sound in the app is synthesized in the browser, so there are no audio files to license or
 * download. Sound stays off until someone turns it on.
 */

const KEY = 'santa-sound';

export function soundEnabled(): boolean {
	try {
		return localStorage.getItem(KEY) === 'on';
	} catch {
		return false;
	}
}

export function setSoundEnabled(on: boolean): void {
	try {
		localStorage.setItem(KEY, on ? 'on' : 'off');
	} catch {
		// Private browsing can block storage. The setting then lasts only for this visit.
	}
}

let context: AudioContext | null = null;

function audio(): AudioContext | null {
	if (!soundEnabled()) return null;
	try {
		context ??= new AudioContext();
		if (context.state === 'suspended') void context.resume();
		return context;
	} catch {
		return null;
	}
}

/** A bell is a few inharmonic partials with a quick strike and a long decay. */
function bell(ctx: AudioContext, frequency: number, start: number, volume: number, decay = 1.4): void {
	const ratios: [number, number][] = [
		[1, 1],
		[2.01, 0.5],
		[3.76, 0.22],
		[5.4, 0.08]
	];
	for (const [ratio, gainScale] of ratios) {
		const oscillator = ctx.createOscillator();
		const gain = ctx.createGain();
		oscillator.type = 'sine';
		oscillator.frequency.value = frequency * ratio;
		gain.gain.setValueAtTime(0.0001, start);
		gain.gain.exponentialRampToValueAtTime(volume * gainScale, start + 0.006);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + decay / ratio);
		oscillator.connect(gain).connect(ctx.destination);
		oscillator.start(start);
		oscillator.stop(start + decay / ratio + 0.05);
	}
}

/** A short jingle of sleigh bells. Intensity (0 to 1) makes them faster and brighter. */
export function jingle(intensity = 0): void {
	const ctx = audio();
	if (!ctx) return;
	const now = ctx.currentTime;
	const count = 2 + Math.round(intensity * 2);
	for (let i = 0; i < count; i++) {
		const base = 2100 + Math.random() * 900 + intensity * 500;
		bell(ctx, base, now + i * 0.055 + Math.random() * 0.02, 0.022 + intensity * 0.02, 0.28);
	}
}

/** A soft wooden tick for each name passing in the reel. */
export function tick(): void {
	const ctx = audio();
	if (!ctx) return;
	const now = ctx.currentTime;
	const oscillator = ctx.createOscillator();
	const gain = ctx.createGain();
	oscillator.type = 'triangle';
	oscillator.frequency.setValueAtTime(1500, now);
	oscillator.frequency.exponentialRampToValueAtTime(380, now + 0.03);
	gain.gain.setValueAtTime(0.05, now);
	gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
	oscillator.connect(gain).connect(ctx.destination);
	oscillator.start(now);
	oscillator.stop(now + 0.06);
}

/** A rising chord of bells when the name lands. */
export function fanfare(): void {
	const ctx = audio();
	if (!ctx) return;
	const now = ctx.currentTime;
	const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
	notes.forEach((note, index) => bell(ctx, note, now + index * 0.11, 0.07, 2.4));
	for (let i = 0; i < 14; i++) {
		bell(ctx, 2400 + Math.random() * 1400, now + 0.35 + i * 0.07, 0.012, 0.3);
	}
}

/** A papery rustle for the ribbon coming undone. */
export function ribbonWhoosh(): void {
	const ctx = audio();
	if (!ctx) return;
	const now = ctx.currentTime;
	const length = Math.floor(ctx.sampleRate * 0.5);
	const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
	const data = buffer.getChannelData(0);
	for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
	const source = ctx.createBufferSource();
	source.buffer = buffer;
	const filter = ctx.createBiquadFilter();
	filter.type = 'bandpass';
	filter.frequency.setValueAtTime(900, now);
	filter.frequency.exponentialRampToValueAtTime(3800, now + 0.45);
	const gain = ctx.createGain();
	gain.gain.setValueAtTime(0.16, now);
	gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
	source.connect(filter).connect(gain).connect(ctx.destination);
	source.start(now);
}
