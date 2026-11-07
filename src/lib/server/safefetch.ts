import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

/**
 * Fetches a family-supplied URL from a server that sits on a home network.
 * Without these checks, a pasted link could make the server read a router or NAS page. The address
 * check runs inside the connection's DNS lookup, so a hostname cannot pass the check and then
 * resolve somewhere private when the connection is made.
 */

const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 7000;
const MAX_BYTES = 2_500_000;
const USER_AGENT = 'SecretSantaLinkPreview/1.0';

function ipv4ToNumber(ip: string): number {
	return ip.split('.').reduce((total, part) => total * 256 + Number(part), 0);
}

function inRange(ip: number, base: string, bits: number): boolean {
	const size = 2 ** (32 - bits);
	const start = ipv4ToNumber(base);
	return ip >= start && ip < start + size;
}

export function isPrivateAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 4) {
		const ip = ipv4ToNumber(address);
		return [
			['0.0.0.0', 8],
			['10.0.0.0', 8],
			['100.64.0.0', 10],
			['127.0.0.0', 8],
			['169.254.0.0', 16],
			['172.16.0.0', 12],
			['192.0.0.0', 24],
			['192.168.0.0', 16],
			['198.18.0.0', 15],
			['224.0.0.0', 4],
			['240.0.0.0', 4]
		].some(([base, bits]) => inRange(ip, base as string, bits as number));
	}
	if (family === 6) {
		// Only ordinary global addresses are allowed: everything from 2000:: to 3fff::. That excludes
		// loopback, link-local, unique-local, multicast, and all the forms that embed an IPv4 address,
		// except for the few global ranges below that tunnel to other networks.
		const lower = address.toLowerCase();
		if (!/^[23][0-9a-f]{0,3}:/.test(lower)) return true;
		return (
			lower.startsWith('2002:') || // 6to4
			lower.startsWith('2001:0:') || // Teredo
			lower.startsWith('2001::') ||
			lower.startsWith('2001:db8:') // documentation
		);
	}
	return true;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

function guardedLookup(hostname: string, options: { all?: boolean }, callback: LookupCallback): void {
	dnsLookup(hostname, { all: true }, (err, addresses) => {
		if (err) return callback(err, '', 0);
		const bad = addresses.find((entry) => isPrivateAddress(entry.address));
		if (bad || !addresses.length) {
			const blocked: NodeJS.ErrnoException = new Error('This address is on a private network.');
			blocked.code = 'EBLOCKED';
			return callback(blocked, '', 0);
		}
		if (options.all) return callback(null, addresses);
		callback(null, addresses[0].address, addresses[0].family);
	});
}

export class FetchBlockedError extends Error {}

export interface SafeResponse {
	status: number;
	url: string;
	contentType: string;
	body: string;
	bytes: Buffer;
	/** True when the response was larger than the limit and was cut short. */
	truncated: boolean;
}

export function parsePublicUrl(raw: string): URL | null {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return null;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	if (url.username || url.password) return null;
	const host = url.hostname.replace(/^\[|\]$/g, '');
	if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
		return null;
	}
	if (isIP(host) && isPrivateAddress(host)) return null;
	return url;
}

function requestOnce(url: URL): Promise<{ status: number; location: string | null; contentType: string; bytes: Buffer; truncated: boolean }> {
	return new Promise((resolve, reject) => {
		const client = url.protocol === 'https:' ? https : http;
		const request = client.get(
			url,
			{
				lookup: guardedLookup as never,
				timeout: TIMEOUT_MS,
				headers: {
					'User-Agent': USER_AGENT,
					Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
					'Accept-Language': 'en-US,en;q=0.8',
					'Accept-Encoding': 'gzip, deflate, br',
					// Says this is a request for a whole page. Some store platforms refuse requests without it.
					'Sec-Fetch-Mode': 'navigate'
				}
			},
			(response) => {
				const status = response.statusCode ?? 0;
				const location = response.headers.location ?? null;
				const contentType = String(response.headers['content-type'] ?? '');
				if (status >= 300 && status < 400 && location) {
					response.resume();
					return resolve({ status, location, contentType, bytes: Buffer.alloc(0), truncated: false });
				}
				// The size limit below applies after decompression, so a small file can't expand without limit.
				const encoding = String(response.headers['content-encoding'] ?? '').toLowerCase();
				const decoder =
					encoding === 'gzip' || encoding === 'x-gzip'
						? createGunzip()
						: encoding === 'br'
							? createBrotliDecompress()
							: encoding === 'deflate'
								? createInflate()
								: null;
				const body = decoder ? response.pipe(decoder) : response;
				if (decoder) response.on('error', reject);

				const chunks: Buffer[] = [];
				let size = 0;
				body.on('data', (chunk: Buffer) => {
					size += chunk.length;
					if (size > MAX_BYTES) {
						request.destroy();
						return resolve({ status, location: null, contentType, bytes: Buffer.concat(chunks), truncated: true });
					}
					chunks.push(chunk);
				});
				body.on('end', () =>
					resolve({ status, location: null, contentType, bytes: Buffer.concat(chunks), truncated: false })
				);
				body.on('error', reject);
			}
		);
		request.on('timeout', () => request.destroy(new Error('The site took too long to answer.')));
		request.on('error', reject);
	});
}

export async function safeFetch(raw: string): Promise<SafeResponse> {
	let url = parsePublicUrl(raw);
	if (!url) throw new FetchBlockedError('That link cannot be used.');
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const result = await requestOnce(url);
		if (!result.location) {
			return {
				status: result.status,
				url: url.toString(),
				contentType: result.contentType,
				body: result.bytes.toString('utf8'),
				bytes: result.bytes,
				truncated: result.truncated
			};
		}
		const next = parsePublicUrl(new URL(result.location, url).toString());
		if (!next) throw new FetchBlockedError('That link redirects somewhere that cannot be used.');
		url = next;
	}
	throw new FetchBlockedError('That link redirects too many times.');
}

/** Skips every link check, so it exists only to test decompression against a local server. */
export { requestOnce as readResponseForTests };
