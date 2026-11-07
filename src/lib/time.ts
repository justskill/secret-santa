/** Time helpers shared by the server and the browser. All stored times are UTC ISO strings. */

function offsetMinutes(utc: Date, timeZone: string): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: 'numeric',
		second: 'numeric'
	}).formatToParts(utc);
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
	const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
	return Math.round((asUtc - utc.getTime()) / 60000);
}

/** Converts a value from a datetime-local input, read as family time, to UTC. */
export function zonedInputToUtc(local: string, timeZone: string): string | null {
	const match = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
	if (!match) return null;
	const [, y, mo, d, h, mi] = match.map(Number);
	const guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
	// Apply the offset twice so a time near a daylight saving change lands on the correct side.
	const first = new Date(guess.getTime() - offsetMinutes(guess, timeZone) * 60000);
	const second = new Date(guess.getTime() - offsetMinutes(first, timeZone) * 60000);
	return second.toISOString();
}

/** Converts a UTC time to the value a datetime-local input expects, in family time. */
export function utcToZonedInput(iso: string | null | undefined, timeZone: string): string {
	if (!iso) return '';
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return '';
	const shifted = new Date(date.getTime() + offsetMinutes(date, timeZone) * 60000);
	return shifted.toISOString().slice(0, 16);
}

export function formatDateTime(iso: string, timeZone: string): string {
	return new Intl.DateTimeFormat('en-US', {
		timeZone,
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	}).format(new Date(iso));
}

export function formatDate(iso: string, timeZone: string): string {
	return new Intl.DateTimeFormat('en-US', {
		timeZone,
		weekday: 'long',
		month: 'long',
		day: 'numeric'
	}).format(new Date(iso));
}

export function relativeTime(iso: string, now = Date.now()): string {
	const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
	const abs = Math.abs(seconds);
	const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
	if (abs < 60) return 'just now';
	if (abs < 3600) return format.format(Math.round(seconds / 60), 'minute');
	if (abs < 86400) return format.format(Math.round(seconds / 3600), 'hour');
	return format.format(Math.round(seconds / 86400), 'day');
}

export function daysLeft(iso: string, now = Date.now()): number {
	return Math.ceil((new Date(iso).getTime() - now) / 86_400_000);
}

export function isValidTimeZone(timeZone: string): boolean {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone });
		return true;
	} catch {
		return false;
	}
}
