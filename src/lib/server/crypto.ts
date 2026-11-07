import {
	createCipheriv,
	createDecipheriv,
	createHash,
	createHmac,
	randomBytes,
	randomInt,
	scrypt as scryptCallback,
	timingSafeEqual
} from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { dataDir } from './env';

const scrypt = promisify(scryptCallback) as (
	password: string,
	salt: Buffer,
	keylen: number,
	options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

let cachedKey: Buffer | null = null;

/**
 * The key that seals pairings and chats at rest. It lives beside the database in the data volume
 * unless SANTA_SECRET is set. This prevents accidental spoilers when someone opens the database;
 * it does not stop a server owner who deliberately goes looking for the key.
 */
function masterKey(): Buffer {
	if (cachedKey) return cachedKey;
	const fromEnv = process.env.SANTA_SECRET?.trim();
	if (fromEnv) {
		cachedKey = createHash('sha256').update(fromEnv).digest();
		return cachedKey;
	}
	const path = resolve(dataDir(), 'secret.key');
	if (existsSync(path)) {
		cachedKey = Buffer.from(readFileSync(path, 'utf8').trim(), 'base64');
	} else {
		cachedKey = randomBytes(32);
		writeFileSync(path, cachedKey.toString('base64'), { mode: 0o600 });
	}
	return cachedKey;
}

export function resetKeyCacheForTests(): void {
	cachedKey = null;
}

/** Encrypts a value so it is unreadable when browsing the database directly. */
export function seal(value: unknown): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
	const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
	return [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url')).join('.');
}

export function unseal<T = unknown>(blob: string): T {
	const [iv, tag, body] = blob.split('.').map((part) => Buffer.from(part, 'base64url'));
	const decipher = createDecipheriv('aes-256-gcm', masterKey(), iv);
	decipher.setAuthTag(tag);
	const plain = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
	return JSON.parse(plain) as T;
}

/** A stable lookup value for a sealed link, such as "this person's gifts". Not reversible without the key. */
export function blindTag(context: string, value: string | number): string {
	return createHmac('sha256', masterKey()).update(`${context}:${value}`).digest('base64url');
}

export function randomToken(bytes = 32): string {
	return randomBytes(bytes).toString('base64url');
}

const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomId(length = 16): string {
	let out = '';
	for (let i = 0; i < length; i++) out += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
	return out;
}

export function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16);
	const derived = await scrypt(password, salt, 32, SCRYPT);
	return `scrypt$${SCRYPT.N}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
	if (!stored) {
		// Spend the same time on unknown accounts so timing does not reveal who has one.
		await scrypt(password, randomBytes(16), 32, SCRYPT);
		return false;
	}
	const [scheme, n, salt, hash] = stored.split('$');
	if (scheme !== 'scrypt') return false;
	const expected = Buffer.from(hash, 'base64url');
	const derived = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length, {
		...SCRYPT,
		N: Number(n)
	});
	return timingSafeEqual(derived, expected);
}
