import { parsePublicUrl, safeFetch } from './safefetch';

export interface LinkPreview {
	url: string;
	title: string | null;
	image: string | null;
	price: string | null;
	site: string | null;
	blocked: boolean;
}

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	'#39': "'",
	'#x27': "'",
	nbsp: ' '
};

export function decodeEntities(text: string): string {
	return text
		.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
			const key = entity.toLowerCase();
			if (key in ENTITIES) return ENTITIES[key];
			if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16));
			if (key.startsWith('#')) return String.fromCodePoint(parseInt(key.slice(1), 10));
			return match;
		})
		.replace(/\s+/g, ' ')
		.trim();
}

function metaContent(html: string, names: string[]): string | null {
	for (const name of names) {
		const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const patterns = [
			new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']+)["']`, 'i'),
			new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${escaped}["']`, 'i')
		];
		for (const pattern of patterns) {
			const match = html.match(pattern);
			if (match?.[1]) return decodeEntities(match[1]);
		}
	}
	return null;
}

function formatPrice(amount: unknown, currency: unknown): string | null {
	if (amount === undefined || amount === null || amount === '') return null;
	const value = Number(amount);
	if (!Number.isFinite(value)) return String(amount);
	const code = typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
	try {
		return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(value);
	} catch {
		return value.toFixed(2);
	}
}

function jsonLdProduct(html: string): { name?: string; image?: string; price?: string | null } | null {
	const blocks = html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi);
	for (const block of blocks) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(block[1]);
		} catch {
			continue;
		}
		const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
		while (queue.length) {
			const node = queue.shift() as Record<string, unknown> | null;
			if (!node || typeof node !== 'object') continue;
			if (Array.isArray(node['@graph'])) queue.push(...(node['@graph'] as unknown[]));
			const type = node['@type'];
			if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) {
				const rawOffers = node.offers as Record<string, unknown> | Record<string, unknown>[] | undefined;
				const offer = Array.isArray(rawOffers) ? rawOffers[0] : rawOffers;
				const image = Array.isArray(node.image) ? node.image[0] : node.image;
				return {
					name: typeof node.name === 'string' ? decodeEntities(node.name) : undefined,
					image: typeof image === 'string' ? image : undefined,
					price: formatPrice(offer?.price ?? offer?.lowPrice, offer?.priceCurrency)
				};
			}
		}
	}
	return null;
}

/**
 * Whether a store refused to show the page. Plenty of normal pages mention words like "captcha" in
 * their scripts, so those words only count on a page with no product details at all.
 */
function looksBlocked(html: string, status: number, hasProductData: boolean): boolean {
	if (status === 403 || status === 429 || status === 503) return true;
	if (hasProductData) return false;
	return /captcha|robot check|are you a human|verify you are human|access denied|enable javascript and cookies/i.test(
		html.slice(0, 20000)
	);
}

/** Amazon pages rarely include the standard tags, but they do have these fields of their own. */
function amazonDetails(html: string): { title: string | null; image: string | null; price: string | null } {
	const title = html.match(/<span[^>]+id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i)?.[1];
	const imageTag = html.match(/<img[^>]+id=["']landingImage["'][^>]*>/i)?.[0] ?? '';
	const image = imageTag.match(/data-old-hires=["'](https:[^"']+)["']/i)?.[1] ?? imageTag.match(/\ssrc=["'](https:[^"']+)["']/i)?.[1];
	const price = html.match(/class=["']a-offscreen["'][^>]*>\s*([$£€][\d.,]+)/i)?.[1];
	return { title: title ? decodeEntities(title) : null, image: image ?? null, price: price ?? null };
}

/** Removes the store name and category from a title like "Amazon.com : Thing : Patio, Lawn & Garden". */
function tidyAmazonTitle(title: string): string {
	return title
		.replace(/^Amazon(\.[a-z.]+)?\s*[:|-]\s*/i, '')
		.replace(/\s*:\s*[^:]+$/, '')
		.trim();
}

export function parseHtmlPreview(html: string, url: string, status = 200): LinkPreview {
	const product = jsonLdProduct(html);
	const onAmazon = isAmazonUrl(url);
	const amazon = onAmazon ? amazonDetails(html) : null;
	const tagTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
	const metaTitle = metaContent(html, ['og:title', 'twitter:title']);
	const pageTitle = tagTitle ? decodeEntities(tagTitle) : null;
	const title =
		amazon?.title ??
		product?.name ??
		metaTitle ??
		(onAmazon && pageTitle ? tidyAmazonTitle(pageTitle) : pageTitle);
	const rawImage = amazon?.image ?? product?.image ?? metaContent(html, ['og:image:secure_url', 'og:image', 'twitter:image']);
	let image: string | null = null;
	if (rawImage) {
		try {
			const resolved = new URL(rawImage, url);
			if (resolved.protocol === 'https:') image = resolved.toString();
		} catch {
			image = null;
		}
	}
	const metaPrice = metaContent(html, ['product:price:amount', 'og:price:amount']);
	const metaCurrency = metaContent(html, ['product:price:currency', 'og:price:currency']);
	const blocked = looksBlocked(html, status, !!(amazon?.title || product?.name || metaTitle));
	return {
		url,
		title: blocked ? null : title,
		image: blocked ? null : image,
		price: blocked ? null : (amazon?.price ?? product?.price ?? formatPrice(metaPrice, metaCurrency)),
		site: metaContent(html, ['og:site_name']) ?? new URL(url).hostname.replace(/^www\./, ''),
		blocked
	};
}

export async function fetchLinkPreview(raw: string): Promise<LinkPreview> {
	const parsed = parsePublicUrl(raw);
	if (!parsed) throw new Error('That does not look like a web link.');
	const fallback: LinkPreview = {
		url: parsed.toString(),
		title: null,
		image: null,
		price: null,
		site: parsed.hostname.replace(/^www\./, ''),
		blocked: true
	};
	try {
		const response = await safeFetch(parsed.toString());
		if (!/html|xml/i.test(response.contentType)) return fallback;
		return parseHtmlPreview(response.body, response.url, response.status);
	} catch {
		return fallback;
	}
}

/* ---- Amazon wish list import (best effort; Amazon has no public list API) ---- */

export interface ImportedItem {
	title: string;
	url: string | null;
	image_url: string | null;
	price_text: string | null;
}

export type AmazonImport =
	| { ok: true; items: ImportedItem[] }
	| { ok: false; reason: 'not_amazon' | 'blocked' | 'empty' };

export function isAmazonUrl(raw: string): boolean {
	const url = parsePublicUrl(raw);
	if (!url) return false;
	const host = url.hostname.toLowerCase();
	return host === 'a.co' || host === 'amzn.to' || /(^|\.)amazon\.[a-z.]{2,8}$/.test(host);
}

export function parseAmazonList(html: string, baseUrl: string): ImportedItem[] {
	const items: ImportedItem[] = [];
	const seen = new Set<string>();
	const pattern = /<a[^>]+id=["']itemName_([A-Z0-9]+)["'][^>]*>/gi;
	for (const match of html.matchAll(pattern)) {
		const tag = match[0];
		const key = match[1];
		if (seen.has(key)) continue;
		seen.add(key);
		const title = tag.match(/title=["']([^"']+)["']/i)?.[1];
		const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
		if (!title) continue;
		const neighbourhood = html.slice(Math.max(0, (match.index ?? 0) - 4000), (match.index ?? 0) + 4000);
		const image = neighbourhood.match(/<img[^>]+src=["'](https:[^"']+)["']/i)?.[1] ?? null;
		const price = neighbourhood.match(/data-price=["'](\d+(?:\.\d+)?)["']/i)?.[1];
		let url: string | null = null;
		if (href) {
			try {
				const resolved = new URL(href.split('?')[0], baseUrl);
				if (resolved.protocol === 'https:' || resolved.protocol === 'http:') url = resolved.toString();
			} catch {
				url = null;
			}
		}
		items.push({
			title: decodeEntities(title),
			url,
			image_url: image,
			price_text: price && Number(price) > 0 ? formatPrice(price, 'USD') : null
		});
	}
	return items;
}

export async function importAmazonList(raw: string): Promise<AmazonImport> {
	if (!isAmazonUrl(raw)) return { ok: false, reason: 'not_amazon' };
	try {
		const response = await safeFetch(raw);
		const items = response.status === 200 ? parseAmazonList(response.body, response.url) : [];
		if (items.length) return { ok: true, items };
		return { ok: false, reason: looksBlocked(response.body, response.status, false) ? 'blocked' : 'empty' };
	} catch {
		return { ok: false, reason: 'blocked' };
	}
}
