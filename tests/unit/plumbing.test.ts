import { describe, expect, it } from 'vitest';
import { buildViewer } from '$lib/server/access';
import { hashPassword, seal, unseal, verifyPassword } from '$lib/server/crypto';
import { createCountdown, listIsLocked } from '$lib/server/countdowns';
import { isPrivateAddress, parsePublicUrl } from '$lib/server/safefetch';
import { isAmazonUrl, parseAmazonList, parseHtmlPreview } from '$lib/server/linkpreview';
import { sniffImageType } from '$lib/server/media';
import { buildNtfyRequest } from '$lib/server/ntfy';
import { createHousehold, createPerson, getPerson, setGuardians } from '$lib/server/people';
import { fireReminder, createReminder, getReminder, recipientsOf, textTargets } from '$lib/server/reminders';
import { createSeason, currentSeason } from '$lib/server/season';
import { setSetting } from '$lib/server/settings';
import { findNameMentions, rewriteForRelay } from '$lib/server/santa/writing';
import { addItem, cleanUrl, ListLockedError } from '$lib/server/wishlist';
import { formatDateTime, utcToZonedInput, zonedInputToUtc } from '$lib/time';
import { renderMarkdown } from '$lib/markdown';

describe('sealing', () => {
	it('round-trips a value and rejects tampering', () => {
		const blob = seal({ a: 1 });
		expect(unseal(blob)).toEqual({ a: 1 });
		const [iv, tag, body] = blob.split('.');
		expect(() => unseal(`${iv}.${tag}.${body.slice(0, -2)}AA`)).toThrow();
	});
	it('produces different output each time', () => {
		expect(seal(5)).not.toBe(seal(5));
	});
});

describe('passwords', () => {
	it('verifies the right password and rejects the wrong one', async () => {
		const hash = await hashPassword('correct horse');
		expect(await verifyPassword('correct horse', hash)).toBe(true);
		expect(await verifyPassword('wrong horse', hash)).toBe(false);
		expect(await verifyPassword('anything', null)).toBe(false);
	});
});

describe('link safety on a home network', () => {
	it('refuses private addresses', () => {
		for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.9', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:192.168.1.1', '::ffff:c0a8:0101']) {
			expect(isPrivateAddress(ip), ip).toBe(true);
		}
	});
	it('allows public addresses', () => {
		for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '172.32.0.1']) {
			expect(isPrivateAddress(ip), ip).toBe(false);
		}
	});
	it('refuses unsafe link types and hosts', () => {
		for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://example.com', 'http://localhost/admin', 'http://192.168.1.1/', 'http://[::1]/', 'http://nas.local/', 'http://user:pw@example.com/', 'data:text/html,hi', 'not a url']) {
			expect(parsePublicUrl(url), url).toBeNull();
		}
		expect(parsePublicUrl('https://www.target.com/p/thing')).not.toBeNull();
	});
	it('stores only web links on wish items', () => {
		expect(cleanUrl('javascript:alert(1)')).toBeNull();
		expect(cleanUrl('  https://example.com/a  ')).toBe('https://example.com/a');
		expect(cleanUrl('')).toBeNull();
	});
});

describe('link previews', () => {
	it('reads product data from a page', () => {
		const html = `<html><head><title>Fallback</title>
			<meta property="og:title" content="Nice &amp; Warm Socks">
			<meta property="og:image" content="https://cdn.example.com/socks.jpg">
			<meta property="og:site_name" content="Sock Shop">
			<meta property="product:price:amount" content="19.5">
			<meta property="product:price:currency" content="USD"></head></html>`;
		const preview = parseHtmlPreview(html, 'https://example.com/socks');
		expect(preview.title).toBe('Nice & Warm Socks');
		expect(preview.image).toBe('https://cdn.example.com/socks.jpg');
		expect(preview.price).toBe('$19.50');
		expect(preview.site).toBe('Sock Shop');
		expect(preview.blocked).toBe(false);
	});
	it('prefers structured product data', () => {
		const html = `<script type="application/ld+json">{"@type":"Product","name":"Skates","image":["https://x.example/s.jpg"],"offers":{"price":"48.00","priceCurrency":"USD"}}</script><title>Shop</title>`;
		const preview = parseHtmlPreview(html, 'https://x.example/s');
		expect(preview.title).toBe('Skates');
		expect(preview.price).toBe('$48.00');
	});
	it('treats a robot check page as blocked rather than as the product', () => {
		const preview = parseHtmlPreview('<title>Robot Check</title><p>Enter the characters</p>', 'https://www.amazon.com/dp/X', 200);
		expect(preview.blocked).toBe(true);
		expect(preview.title).toBeNull();
	});
	it('does not mistake a normal page that mentions captcha for a blocked one', () => {
		const html = '<script>loadRecaptcha("captcha")</script><meta property="og:title" content="Seed Kit"><title>Shop</title>';
		const preview = parseHtmlPreview(html, 'https://store.example/kit');
		expect(preview.blocked).toBe(false);
		expect(preview.title).toBe('Seed Kit');
	});
	it('treats a refused request as blocked, whatever the page says', () => {
		const preview = parseHtmlPreview('<meta property="og:title" content="Nope">', 'https://store.example/kit', 403);
		expect(preview.blocked).toBe(true);
		expect(preview.title).toBeNull();
	});
	it("reads Amazon's own product fields", () => {
		const html = `<title>Amazon.com : Herb Kit : Patio, Lawn &amp; Garden</title>
			<span id="productTitle" class="a-size-large">  Herb Kit &amp; Seeds  </span>
			<img alt="" src="https://m.media-amazon.com/small.jpg" data-old-hires="https://m.media-amazon.com/large.jpg" id="landingImage">
			<span class="a-offscreen">$24.99</span>`;
		const preview = parseHtmlPreview(html, 'https://www.amazon.com/dp/B07XL4VHJC');
		expect(preview.title).toBe('Herb Kit & Seeds');
		expect(preview.image).toBe('https://m.media-amazon.com/large.jpg');
		expect(preview.price).toBe('$24.99');
	});
	it('tidies an Amazon page title when the product fields are missing', () => {
		const preview = parseHtmlPreview('<title>Amazon.com : Herb Kit, Basil &amp; Mint : Patio, Lawn &amp; Garden</title>', 'https://www.amazon.com/dp/B07XL4VHJC');
		expect(preview.title).toBe('Herb Kit, Basil & Mint');
	});
	it('drops insecure images', () => {
		const preview = parseHtmlPreview('<meta property="og:image" content="http://x.example/a.jpg"><title>T</title>', 'https://x.example');
		expect(preview.image).toBeNull();
	});
});

describe('Amazon lists', () => {
	it('recognises Amazon links', () => {
		expect(isAmazonUrl('https://www.amazon.com/hz/wishlist/ls/ABC')).toBe(true);
		expect(isAmazonUrl('https://www.amazon.co.uk/hz/wishlist/ls/ABC')).toBe(true);
		expect(isAmazonUrl('https://a.co/d/abc')).toBe(true);
		expect(isAmazonUrl('https://amazon.example.com/')).toBe(false);
		expect(isAmazonUrl('https://notamazon.com/')).toBe(false);
	});
	it('parses the items out of a list page', () => {
		const html = `<li data-itemid="I1" data-price="24.99">
			<img src="https://m.media-amazon.com/images/a.jpg">
			<a id="itemName_I1ABC" title="Cast Iron &amp; Skillet" href="/dp/B01/ref=x?coliid=I1">Cast Iron</a></li>`;
		const items = parseAmazonList(html, 'https://www.amazon.com/hz/wishlist/ls/ABC');
		expect(items).toHaveLength(1);
		expect(items[0].title).toBe('Cast Iron & Skillet');
		expect(items[0].url).toBe('https://www.amazon.com/dp/B01/ref=x');
		expect(items[0].price_text).toBe('$24.99');
		expect(items[0].image_url).toBe('https://m.media-amazon.com/images/a.jpg');
	});
});

describe('fetching compressed pages', () => {
	it('reads gzip and brotli pages, and refuses to expand past the size limit', async () => {
		const { createServer } = await import('node:http');
		const { brotliCompressSync, gzipSync } = await import('node:zlib');
		const { readResponseForTests: readResponse } = await import('$lib/server/safefetch');

		const page = '<meta property="og:title" content="Seed Kit">';
		const huge = Buffer.alloc(10_000_000, 'a');
		const server = createServer((request, response) => {
			if (request.url === '/gzip') {
				response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' });
				response.end(gzipSync(page));
			} else if (request.url === '/br') {
				response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'br' });
				response.end(brotliCompressSync(page));
			} else if (request.url === '/plain') {
				response.writeHead(200, { 'Content-Type': 'text/html' });
				response.end(page);
			} else {
				response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' });
				response.end(gzipSync(huge));
			}
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const { port } = server.address() as { port: number };
		try {
			for (const path of ['/gzip', '/br', '/plain']) {
				const result = await readResponse(new URL(`http://127.0.0.1:${port}${path}`));
				expect(result.bytes.toString('utf8'), path).toBe(page);
				expect(result.truncated, path).toBe(false);
			}
			const bomb = await readResponse(new URL(`http://127.0.0.1:${port}/bomb`));
			expect(bomb.truncated).toBe(true);
			expect(bomb.bytes.length).toBeLessThan(3_000_000);
		} finally {
			server.close();
		}
	});
});

describe('photo uploads', () => {
	it('trusts the file contents, not the file name', () => {
		expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
		expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('png');
		expect(sniffImageType(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull();
	});
});

describe('family time', () => {
	it('converts family time to UTC, including across daylight saving', () => {
		expect(zonedInputToUtc('2026-12-24T18:00', 'America/Chicago')).toBe('2026-12-25T00:00:00.000Z');
		expect(zonedInputToUtc('2026-07-04T18:00', 'America/Chicago')).toBe('2026-07-04T23:00:00.000Z');
		expect(zonedInputToUtc('2026-12-24T18:00', 'Asia/Tokyo')).toBe('2026-12-24T09:00:00.000Z');
	});
	it('round-trips through a form input', () => {
		for (const zone of ['America/Chicago', 'America/New_York', 'Europe/London', 'Australia/Sydney']) {
			const utc = zonedInputToUtc('2026-11-20T09:30', zone)!;
			expect(utcToZonedInput(utc, zone)).toBe('2026-11-20T09:30');
		}
	});
	it('rejects junk', () => {
		expect(zonedInputToUtc('nonsense', 'UTC')).toBeNull();
		expect(formatDateTime('2026-12-25T00:00:00.000Z', 'America/Chicago')).toContain('Dec 24');
	});
});

describe('chat text rendering', () => {
	it('escapes any HTML from a message', () => {
		const html = renderMarkdown('<img src=x onerror=alert(1)> **bold**');
		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;img');
		expect(html).toContain('<strong>bold</strong>');
	});
	it('only makes web links clickable', () => {
		expect(renderMarkdown('[a](javascript:alert(1))')).not.toContain('<a ');
		const safe = renderMarkdown('[shop](https://example.com/x)');
		expect(safe).toContain('href="https://example.com/x"');
		expect(safe).toContain('rel="noopener noreferrer"');
	});
	it('renders lists', () => {
		expect(renderMarkdown('- one\n- two')).toBe('<ul><li>one</li><li>two</li></ul>');
	});
});

describe('relay rewriting without AI', () => {
	it('passes the text through unchanged and warns the sender', async () => {
		const result = await rewriteForRelay({ text: 'Hi', purpose: 'follow_up', senderName: 'Nobody' });
		expect(result.text).toBe('Hi');
		expect(result.rewritten).toBe(false);
		expect(result.notes.length).toBeGreaterThan(0);
	});
	it('spots family names in a message', () => {
		expect(findNameMentions('Tell Carol it was me, Bob', ['Carol Smith', 'Bob Jones', 'Al Roe'])).toEqual(expect.arrayContaining(['Carol', 'Bob']));
		expect(findNameMentions('Nothing here', ['Carol'])).toEqual([]);
	});
});

describe('ntfy', () => {
	it('sends JSON with the topic, token, and tap target', () => {
		setSetting('ntfy_topic', 'santa-test');
		setSetting('ntfy_url', 'https://ntfy.example.com/');
		setSetting('ntfy_token', 'tk_abc');
		const { url, init } = buildNtfyRequest({ title: 'Ho ho', message: 'Hi', click: 'https://santa.test/admin' });
		expect(url).toBe('https://ntfy.example.com');
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tk_abc');
		expect(JSON.parse(init.body as string)).toMatchObject({ topic: 'santa-test', title: 'Ho ho', click: 'https://santa.test/admin' });
		setSetting('ntfy_topic', '');
		setSetting('ntfy_token', '');
	});
});

describe('kids, profiles, and reminders', () => {
	it('only lets a guardian act as their own kids', () => {
		const home = createHousehold('Home');
		const parent = createPerson({ display_name: 'Pat Parent', kind: 'adult', household_id: home.id });
		const kid = createPerson({ display_name: 'Kit Kid', kind: 'kid', household_id: home.id });
		const stranger = createPerson({ display_name: 'Sam Stranger', kind: 'adult' });
		const otherKid = createPerson({ display_name: 'Otto Other', kind: 'kid' });
		setGuardians(kid.id, [parent.id]);
		expect(buildViewer(parent, kid.id, getPerson).profile.id).toBe(kid.id);
		// Asking to act as anyone else silently falls back to yourself.
		expect(buildViewer(parent, otherKid.id, getPerson).profile.id).toBe(parent.id);
		expect(buildViewer(stranger, kid.id, getPerson).profile.id).toBe(stranger.id);
	});

	it("sends a kid's reminder to their guardians", () => {
		const a = createPerson({ display_name: 'Alex Adult', kind: 'adult', phone: '+1555' });
		const b = createPerson({ display_name: 'Bo Adult', kind: 'adult' });
		const kid = createPerson({ display_name: 'Cam Kid', kind: 'kid' });
		setGuardians(kid.id, [a.id, b.id]);
		const targets = textTargets([a, kid]);
		const forA = targets.find((t) => t.adult.id === a.id)!;
		const forB = targets.find((t) => t.adult.id === b.id)!;
		expect(forA.about).toEqual(['Cam']);
		expect(forB.about).toEqual(['Cam']);
	});

	it('moves a due reminder to the desk with its recipients, using a template when AI is off', async () => {
		const season = currentSeason() ?? createSeason('Reminders');
		const id = createReminder({ seasonId: season.id, title: 'Lists are due', audience: 'everyone', fireAt: new Date().toISOString() });
		await fireReminder(id);
		const reminder = getReminder(id)!;
		expect(reminder.status).toBe('ready');
		expect(reminder.draft).toContain('https://santa.test');
		expect(recipientsOf(id).length).toBeGreaterThan(0);
	});
});

describe('deadlines', () => {
	it('locks lists only when a locking deadline has passed', () => {
		const season = createSeason('Lock test');
		const person = createPerson({ display_name: 'Lena Locked', kind: 'adult' });
		const countdown = createCountdown(season.id, {
			title: 'Soft',
			target_at: new Date(Date.now() - 1000).toISOString(),
			kind: 'list_deadline',
			hard_lock: false
		});
		expect(countdown).toBeGreaterThan(0);
		expect(listIsLocked(season.id)).toBe(false);
		addItem(season, person.id, { title: 'Allowed' });

		createCountdown(season.id, {
			title: 'Hard',
			target_at: new Date(Date.now() - 1000).toISOString(),
			kind: 'list_deadline',
			hard_lock: true
		});
		expect(listIsLocked(season.id)).toBe(true);
		expect(() => addItem(season, person.id, { title: 'Refused' })).toThrow(ListLockedError);
	});
});
