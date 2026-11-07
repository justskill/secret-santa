import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mediaDir } from './env';
import { safeFetch } from './safefetch';

const MAX_BYTES = 6 * 1024 * 1024;

const TYPES: Record<string, string> = {
	jpg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp'
};

/** Identifies an image from its first bytes. A file's name or claimed type is not trusted. */
export function sniffImageType(bytes: Uint8Array): 'jpg' | 'png' | 'webp' | null {
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
	if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
	if (
		bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
		bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
	) {
		return 'webp';
	}
	return null;
}

export async function savePhoto(file: File): Promise<{ ok: true; name: string } | { ok: false; message: string }> {
	if (file.size > MAX_BYTES) return { ok: false, message: 'That photo is too large. Please use one under 6 MB.' };
	const bytes = new Uint8Array(await file.arrayBuffer());
	const type = sniffImageType(bytes);
	if (!type) return { ok: false, message: 'Please choose a JPG, PNG, or WebP photo.' };
	const name = `${randomBytes(12).toString('hex')}.${type}`;
	writeFileSync(resolve(mediaDir(), name), bytes);
	return { ok: true, name };
}

/** Copies a remote image to this server through the same protections as any pasted link. */
export async function cacheRemoteImage(raw: string | null | undefined): Promise<string | null> {
	if (!raw) return null;
	if (raw.startsWith('/media/')) return raw;
	try {
		const response = await safeFetch(raw);
		if (response.status !== 200 || response.truncated || response.bytes.length > MAX_BYTES) return null;
		const type = sniffImageType(response.bytes);
		if (!type) return null;
		const name = `${randomBytes(12).toString('hex')}.${type}`;
		writeFileSync(resolve(mediaDir(), name), response.bytes);
		return `/media/${name}`;
	} catch {
		return null;
	}
}

export function deletePhoto(name: string | null): void {
	if (!name || !/^[a-f0-9]{24}\.(jpg|png|webp)$/.test(name)) return;
	const path = resolve(mediaDir(), name);
	if (existsSync(path)) unlinkSync(path);
}

export function readPhoto(name: string): { bytes: Buffer; type: string } | null {
	const match = name.match(/^[a-f0-9]{24}\.(jpg|png|webp)$/);
	if (!match) return null;
	const path = resolve(mediaDir(), name);
	if (!existsSync(path)) return null;
	return { bytes: readFileSync(path), type: TYPES[match[1]] };
}
