import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const PASSWORD = 'jinglebells';
const SHOTS = 'test-results/shots';
mkdirSync(SHOTS, { recursive: true });

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 860 };

async function shot(page: Page, name: string, fullPage = false) {
	if (!fullPage) {
		await page.waitForTimeout(250);
		await page.screenshot({ path: `${SHOTS}/${name}.png` });
		return;
	}
	const original = page.viewportSize()!;
	await page.evaluate(() => window.scrollTo(0, 0));
	const height = await page.evaluate(() => document.documentElement.scrollHeight);
	await page.setViewportSize({ width: original.width, height: Math.min(height, 2600) });
	// Let entrance animations finish, so the picture shows the settled page.
	await page.waitForTimeout(1000);
	await page.screenshot({ path: `${SHOTS}/${name}.png` });
	await page.setViewportSize(original);
}

async function signIn(browser: Browser, username: string, viewport = DESKTOP): Promise<{ context: BrowserContext; page: Page }> {
	const context = await browser.newContext({ viewport });
	const page = await context.newPage();
	await page.goto('/login');
	await page.getByLabel('Your name').fill(username);
	await page.getByLabel('Password').fill(PASSWORD);
	await page.getByRole('button', { name: 'Come on in' }).click();
	await page.waitForURL((url) => !url.pathname.startsWith('/login'));
	return { context, page };
}

async function actAs(page: Page, firstName: string) {
	await page.goto('/profiles');
	await page.locator('.profile', { hasText: firstName }).click();
	await page.waitForURL('/');
}

/** Holds the box until the ribbon comes undone, then waits for the result card. */
async function openGift(page: Page) {
	await page.goto('/draw');
	const gift = page.locator('button.gift');
	await expect(gift).toBeVisible();
	await gift.hover();
	await page.mouse.down();
	await page.waitForTimeout(2500);
	await page.mouse.up();
}

/** Who each profile drew, as the test learns it the same way a family member does. */
const draws = new Map<string, string>();

/** Stands in for ntfy, so a test can see exactly what would reach the organizer's phone. */
const pings: { title: string; message: string }[] = [];
let fakeNtfy: Server;

const mailPings = () => pings.filter((ping) => ping.title.startsWith('North Pole Mail'));
const familyOf = (name: string) => ({ Frost: 'The Frosts', Winters: 'The Winters', Snow: 'The Snows' })[name.split(' ')[1]]!;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
	fakeNtfy = createServer((request, response) => {
		let body = '';
		request.on('data', (chunk) => (body += chunk));
		request.on('end', () => {
			pings.push(JSON.parse(body));
			response.end('{}');
		});
	});
	await new Promise<void>((resolve) => fakeNtfy.listen(0, '127.0.0.1', resolve));
});

test.afterAll(() => {
	fakeNtfy.close();
});

test('the login page rejects a wrong password and shows the demo family', async ({ page }) => {
	await page.setViewportSize(PHONE);
	await page.goto('/');
	await expect(page).toHaveURL(/\/login/);
	await expect(page.getByText('Demo family')).toBeVisible();
	await shot(page, '01-login-phone', true);

	await page.getByLabel('Your name').fill('morgan');
	await page.getByLabel('Password').fill('not the password');
	await page.getByRole('button', { name: 'Come on in' }).click();
	await expect(page.getByRole('alert')).toContainText("didn't match");
});

test('pages and APIs refuse anyone who is not signed in', async ({ request }) => {
	for (const path of ['/api/draw/reveal', '/api/santa/chat', '/api/relay/preview', '/api/link-preview']) {
		const response = await request.post(path, { data: {}, headers: { Origin: 'http://localhost:4173' } });
		expect(response.status(), path).toBe(401);
	}
	const admin = await request.get('/admin', { maxRedirects: 0 });
	expect(admin.status()).toBe(303);
	const media = await request.get('/media/abc.jpg');
	expect(media.status()).toBe(401);
});

test('a parent sees a profile picker and the home page', async ({ browser }) => {
	const { context, page } = await signIn(browser, 'morgan');
	await expect(page).toHaveURL(/\/profiles/);
	await expect(page.getByText("Who's shopping today?")).toBeVisible();
	await expect(page.locator('.profile')).toHaveCount(3);
	await shot(page, '02-profiles');

	await page.locator('.profile', { hasText: 'Morgan' }).click();
	await page.waitForURL('/');
	await expect(page.locator('.countdown').first()).toBeVisible();
	await expect(page.locator('.tile').first()).not.toHaveText('--');
	await shot(page, '03-home-desktop', true);

	await page.setViewportSize(PHONE);
	await page.reload();
	await shot(page, '04-home-phone', true);
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
	expect(overflow, 'home page must not scroll sideways on a phone').toBe(false);
	await context.close();
});

test('someone who is not an admin cannot reach the admin pages or their actions', async ({ browser }) => {
	const { context, page } = await signIn(browser, 'june');
	await expect(page).toHaveURL('/');
	const response = await page.goto('/admin');
	expect(response?.status()).toBe(403);
	const post = await page.request.post('/admin/season?/seal', {
		form: {},
		headers: { Origin: 'http://localhost:4173' }
	});
	expect(post.status()).toBe(403);
	await context.close();
});

test('the admin checks the rules and seals the draw', async ({ browser }) => {
	const { context, page } = await signIn(browser, 'morgan');
	await page.goto('/admin');
	await shot(page, '05-admin-overview', true);

	await page.goto('/admin/people');
	await expect(page.getByRole('cell', { name: /Ivy Frost/ })).toBeVisible();
	await shot(page, '06-admin-people', true);

	await page.goto('/admin/season');
	await expect(page.getByText('The rules work')).toBeVisible();
	await shot(page, '07-admin-season', true);
	await page.getByRole('button', { name: 'Seal the names' }).click();
	await page.getByRole('button', { name: 'Yes, seal the names' }).click();
	await expect(page.getByRole('status')).toContainText('sealed');
	await expect(page.getByText('Published fingerprint')).toBeVisible();

	// The admin's screen shows progress, and no names paired with names.
	const body = await page.locator('main').innerText();
	expect(body).not.toMatch(/ has (Morgan|Casey|Ivy|Theo|Jordan|Riley|Poppy|Max|June|Walt)/);
	await shot(page, '08-admin-sealed', true);
	await context.close();
});

test('once sealed, the name is front and center for anyone who has not opened it', async ({ browser }) => {
	// An adult with no kids lands on home, with the name at the very top.
	const { context, page } = await signIn(browser, 'walt', PHONE);
	await expect(page).toHaveURL('/');
	const hero = page.locator('a.draw-hero');
	await expect(hero).toBeVisible();
	await expect(hero).toContainText('Your name is ready to open');
	const box = await hero.boundingBox();
	expect(box!.y, 'the name should be near the top of the page').toBeLessThan(120);
	await expect(page.locator('.bottom-tabs a[href="/draw"]')).toBeVisible();
	await shot(page, '09a-home-draw-ready-phone', true);
	await hero.click();
	await page.waitForURL('/draw');
	await expect(page.locator('button.gift')).toBeVisible();
	await context.close();

	// A parent sees which profiles have an unopened name before choosing one.
	const parent = await signIn(browser, 'morgan');
	await expect(parent.page).toHaveURL(/\/profiles/);
	await expect(parent.page.getByText('Name ready!')).toHaveCount(3);
	await shot(parent.page, '09b-picker-draw-ready');
	await parent.page.locator('.profile', { hasText: 'Morgan' }).click();
	await parent.page.waitForURL('/');
	await expect(parent.page.locator('a.draw-hero')).toBeVisible();
	await expect(parent.page.locator('.other')).toHaveCount(2);
	await shot(parent.page, '09c-home-draw-ready-desktop', true);

	// Tapping a kid in that list goes straight to their profile, with their name waiting.
	await parent.page.locator('.other', { hasText: 'Ivy' }).click();
	await expect(parent.page.locator('a.draw-hero')).toContainText('A name is ready for Ivy to open');
	await expect(parent.page.getByText("You're helping")).toBeVisible();
	await expect(parent.page.locator('.other', { hasText: 'Morgan' })).toBeVisible();
	await parent.context.close();
});

test('the draw ceremony: hold the box, watch the reel, land on a name', async ({ browser }) => {
	const { context, page } = await signIn(browser, 'june', PHONE);
	await page.goto('/draw');
	await shot(page, '09-draw-waiting-phone');

	// Before the name is revealed, it is nowhere in the page.
	const before = await page.content();
	expect(before).not.toContain('You are Secret Santa for');

	// Letting go early does not open the box.
	const gift = page.locator('button.gift');
	await gift.hover();
	await page.mouse.down();
	await page.waitForTimeout(900);
	await shot(page, '10-draw-holding-phone');
	await page.mouse.up();
	await page.waitForTimeout(400);
	await expect(page.locator('.reel-window')).toHaveCount(0);

	await gift.hover();
	await page.mouse.down();
	await page.waitForTimeout(2500);
	await page.mouse.up();

	await expect(page.locator('.reel-window')).toBeVisible({ timeout: 4000 });
	await page.waitForTimeout(1500);
	await shot(page, '11-draw-reel-phone');

	await expect(page.locator('.result-card')).toBeVisible({ timeout: 12000 });
	await page.waitForTimeout(700);
	await shot(page, '12-draw-result-phone');
	const name = (await page.locator('.result-card h1').innerText()).trim();
	expect(name).toBeTruthy();
	expect(name).not.toBe('June Snow');
	expect(name).not.toBe('Walt Snow');
	draws.set('June Snow', name);

	// Coming back shows the same name, and it can be replayed.
	await page.goto('/draw');
	await expect(page.locator('h1.winner')).toHaveText(name);
	await page.getByRole('button', { name: 'Replay the reveal' }).click();
	await expect(page.locator('button.gift')).toBeVisible();
	await context.close();
});

test('everyone else draws, including kids through their parents', async ({ browser }) => {
	test.setTimeout(240_000);
	const adults = [
		{ username: 'morgan', name: 'Morgan Frost', kids: ['Ivy', 'Theo'] },
		{ username: 'casey', name: 'Casey Frost', kids: [] },
		{ username: 'jordan', name: 'Jordan Winters', kids: ['Poppy', 'Max'] },
		{ username: 'riley', name: 'Riley Winters', kids: [] },
		{ username: 'walt', name: 'Walt Snow', kids: [] }
	];
	const reveal = async (page: Page) => {
		const response = await page.request.post('/api/draw/reveal', { headers: { Origin: 'http://localhost:4173' } });
		expect(response.ok()).toBe(true);
		return ((await response.json()) as { recipient: { name: string } }).recipient.name;
	};
	for (const adult of adults) {
		const { context, page } = await signIn(browser, adult.username);
		if (adult.kids.length) await actAs(page, adult.name.split(' ')[0]);
		draws.set(adult.name, await reveal(page));
		for (const kid of adult.kids) {
			await actAs(page, kid);
			draws.set(`${kid} ${adult.name.split(' ')[1]}`, await reveal(page));
		}
		await context.close();
	}
	expect(draws.size).toBe(10);

	// With every name open, the prompts are gone.
	const after = await signIn(browser, 'morgan');
	await actAs(after.page, 'Morgan');
	await expect(after.page.locator('a.draw-hero')).toHaveCount(0);
	await expect(after.page.locator('.other')).toHaveCount(0);
	await after.context.close();

	const receivers = new Set(draws.values());
	expect(receivers.size).toBe(10);
	for (const [giver, receiver] of draws) {
		expect(receiver).not.toBe(giver);
		expect(receiver.split(' ')[1], `${giver} must not draw their own household`).not.toBe(giver.split(' ')[1]);
	}
});

test('a kid profile shows whose portal it is, and the kid has their own list', async ({ browser }) => {
	const { context, page } = await signIn(browser, 'morgan', PHONE);
	await actAs(page, 'Ivy');
	await expect(page.getByText("You're helping")).toBeVisible();
	await page.goto('/my-list');
	await expect(page.getByText('Watercolor paint set')).toBeVisible();
	await shot(page, '13-kid-list-phone', true);
	await page.goto('/my-person');
	await expect(page.getByText('Ivy is shopping for')).toBeVisible();
	await shot(page, '14-kid-my-person-phone', true);
	await context.close();
});

test('a list is visible to its owner and their Santa, and nobody else', async ({ browser }) => {
	// June's list has a herb garden on it. Find who drew June, and someone who did not.
	const santaOfJune = [...draws].find(([, receiver]) => receiver === 'June Snow')![0];
	const someoneElse = [...draws.keys()].find((name) => name !== santaOfJune && name !== 'June Snow' && !['Ivy', 'Theo', 'Poppy', 'Max'].includes(name.split(' ')[0]))!;

	const login = (name: string) => {
		const first = name.split(' ')[0];
		const kidParents: Record<string, string> = { Ivy: 'morgan', Theo: 'morgan', Poppy: 'jordan', Max: 'jordan' };
		return { username: kidParents[first] ?? first.toLowerCase(), first, isKid: first in kidParents };
	};

	const santa = login(santaOfJune);
	const { context: santaContext, page: santaPage } = await signIn(browser, santa.username);
	if (santa.isKid) await actAs(santaPage, santa.first);
	await santaPage.goto('/my-person');
	await expect(santaPage.getByText('June Snow').first()).toBeVisible();
	await expect(santaPage.getByText('Herb garden starter')).toBeVisible();
	await shot(santaPage, '15-my-person-desktop', true);
	await santaContext.close();

	const other = login(someoneElse);
	const { context: otherContext, page: otherPage } = await signIn(browser, other.username);
	await otherPage.goto('/my-person');
	if (draws.get(someoneElse) !== 'June Snow') {
		await expect(otherPage.getByText('Herb garden starter')).toHaveCount(0);
	}
	await otherContext.close();
});

test('a wish can be added, edited, and removed, and the list marked ready', async ({ browser }) => {
	const { context, page } = await signIn(browser, 'casey');
	await page.goto('/my-list');
	await page.getByLabel('What is it?').fill('Wool slippers');
	await page.getByLabel('Price (optional)').fill('$30');
	await page.getByRole('button', { name: 'Add to the list' }).click();
	await expect(page.getByRole('heading', { name: 'Wool slippers' })).toBeVisible();

	// A script link is refused by the browser's URL rules and the server's.
	const bad = await page.request.post('/my-list?/add', {
		form: { title: 'Evil', url: 'javascript:alert(1)' },
		headers: { Origin: 'http://localhost:4173' }
	});
	const badBody = await bad.text();
	expect(badBody).toContain('look right');

	await page.getByRole('button', { name: 'My list is ready' }).click();
	await expect(page.locator('.chip-good', { hasText: 'Ready' })).toBeVisible();
	await shot(page, '16-my-list-desktop', true);
	await context.close();
});

test('the organizer can connect ntfy, and mail pings are on', async ({ browser }) => {
	const { context, page } = await signIn(browser, 'morgan');
	await page.goto('/admin/settings');
	await page.getByLabel('Server', { exact: true }).fill(`http://127.0.0.1:${(fakeNtfy.address() as AddressInfo).port}`);
	await page.getByLabel('Topic').fill('santa-family');
	await expect(page.getByLabel('Ping me when North Pole Mail arrives')).toBeChecked();
	await page.getByRole('button', { name: 'Save' }).nth(1).click();
	await expect(page.getByRole('status')).toContainText('Saved');
	await page.getByRole('button', { name: 'Send a test' }).click();
	await expect(page.getByRole('status')).toContainText('Check your phone');
	expect(pings.map((ping) => ping.title)).toEqual(['Ho ho ho!']);
	await context.close();
});

test('an anonymous question reaches its person, and the answer comes back', async ({ browser }) => {
	const [santaName, subject] =[...draws].find(([giver, receiver]) => !/Ivy|Theo|Poppy|Max/.test(giver) && !/Ivy|Theo|Poppy|Max/.test(receiver))!;
	const santaUser = santaName.split(' ')[0].toLowerCase();
	const subjectUser = subject.split(' ')[0].toLowerCase();

	const { context: santaContext, page: santaPage } = await signIn(browser, santaUser);
	if (['morgan', 'jordan'].includes(santaUser)) await actAs(santaPage, santaName.split(' ')[0]);
	await santaPage.goto('/my-person');
	await santaPage.getByLabel('What do you want to know?').fill('What size shoes do you wear?');
	await santaPage.getByRole('button', { name: 'Let Santa reword it' }).click();
	// There is no API key in this test, so the warning about sending it unchanged appears.
	await expect(santaPage.getByText('exactly as you wrote it')).toBeVisible();
	await shot(santaPage, '17-relay-preview', true);
	await santaPage.getByRole('button', { name: 'Send anonymously' }).click();
	await expect(santaPage.getByRole('status').first()).toContainText('elves have it');

	// The demo delay is under a minute. The scheduler checks every 20 seconds.
	const { context: subjectContext, page: subjectPage } = await signIn(browser, subjectUser);
	if (['morgan', 'jordan'].includes(subjectUser)) await actAs(subjectPage, subject.split(' ')[0]);
	await expect
		.poll(
			async () => {
				await subjectPage.goto('/mail');
				return subjectPage.getByText('What size shoes do you wear?').count();
			},
			{ timeout: 100_000, intervals: [5000] }
		)
		.toBeGreaterThan(0);

	const mail = await subjectPage.locator('main').innerText();
	expect(mail).not.toContain(santaName);
	await expect(subjectPage.getByText('Needs your answer')).toBeVisible();

	// The organizer's phone hears which family it went to, and nothing else.
	await expect.poll(() => mailPings().length, { timeout: 30_000 }).toBe(1);
	expect(mailPings()[0].title).toBe(`North Pole Mail: ${familyOf(subject)}`);
	const ping = JSON.stringify(mailPings()[0]);
	expect(ping).not.toContain(santaName.split(' ')[0]);
	expect(ping).not.toContain(subject.split(' ')[0]);
	expect(ping).not.toContain(familyOf(santaName));
	expect(ping).not.toContain('shoes');

	await shot(subjectPage, '18-mail-question', true);

	// Having read it isn't enough: it stays up everywhere until it's answered.
	await subjectPage.goto('/');
	await expect(subjectPage.locator('.waiting')).toContainText('What size shoes do you wear?');
	await shot(subjectPage, '18a-home-mail-waiting', true);
	await expect(subjectPage.locator('.desktop-tab[href="/mail"] .badge')).toHaveText('1');
	await subjectPage.goto('/notices');
	await expect(subjectPage.locator('.waiting')).toContainText('What size shoes do you wear?');
	await subjectPage.goto('/notices');
	await expect(subjectPage.locator('.waiting')).toBeVisible();
	await expect(subjectPage.locator('a[href="/notices"] .badge')).toBeVisible();
	await subjectPage.goto('/');
	await subjectPage.locator('.waiting a').click();
	await subjectPage.waitForURL(/\/mail#thread-/);

	await subjectPage.getByLabel('Your answer').fill('Size 9, thanks!');
	await subjectPage.getByRole('button', { name: 'Send answer' }).click();
	await expect(subjectPage.getByRole('status').first()).toContainText('passed along');

	// Answering clears it from home, and from the badge.
	await subjectPage.goto('/');
	await expect(subjectPage.locator('.waiting')).toHaveCount(0);
	await expect(subjectPage.locator('.desktop-tab[href="/mail"] .badge')).toHaveCount(0);
	await subjectContext.close();

	await santaPage.goto('/mail');
	await expect(santaPage.getByText('Size 9, thanks!')).toBeVisible();
	await santaContext.close();
});

test('a permission slip goes to the kid\'s parents, not the kid or the buyer', async ({ browser }) => {
	test.setTimeout(180_000);
	const [santaName, kid] = [...draws].find(([giver, receiver]) => /^(Casey|Riley|June|Walt)/.test(giver) && /Ivy|Theo|Poppy|Max/.test(receiver))!
		?? [...draws].find(([, receiver]) => /Ivy|Theo|Poppy|Max/.test(receiver))!;
	const parents = /Ivy|Theo/.test(kid) ? ['morgan', 'casey'] : ['jordan', 'riley'];
	const kidFirst = kid.split(' ')[0];

	const kidParents: Record<string, string> = { Ivy: 'morgan', Theo: 'morgan', Poppy: 'jordan', Max: 'jordan' };
	const first = santaName.split(' ')[0];
	const santaUser = kidParents[first] ?? first.toLowerCase();
	const { context: santaContext, page: santaPage } = await signIn(browser, santaUser);
	if (['morgan', 'jordan'].includes(santaUser)) await actAs(santaPage, first);

	await santaPage.goto('/my-person');
	await expect(santaPage.getByText('Thinking of something not on the list?')).toBeVisible();
	await santaPage.getByLabel("What's the gift?").fill('A small drum kit');
	await santaPage.getByLabel('About how much?').fill('$60');
	await santaPage.getByRole('button', { name: 'Let Santa write the slip' }).click();
	await santaPage.getByRole('button', { name: 'Send the slip' }).click();
	await expect(santaPage.getByRole('status').first()).toContainText('on its way');
	await santaPage.reload();
	await expect(santaPage.locator('.chip-warn', { hasText: 'Waiting for an answer' })).toBeVisible();
	await shot(santaPage, '19-slip-waiting', true);

	const parentUser = parents[0];
	const { context: parentContext, page: parentPage } = await signIn(browser, parentUser);
	await actAs(parentPage, parentUser[0].toUpperCase() + parentUser.slice(1));
	await expect
		.poll(
			async () => {
				await parentPage.goto('/mail');
				return parentPage.getByText('A small drum kit').count();
			},
			{ timeout: 100_000, intervals: [5000] }
		)
		.toBeGreaterThan(0);
	await shot(parentPage, '20-slip-for-parent', true);
	const parentView = await parentPage.locator('main').innerText();
	expect(parentView).not.toContain(santaName);

	// One ping for the question and one for this slip. The answer in between didn't add one,
	// because it would have named the family of whoever asked.
	await expect.poll(() => mailPings().length, { timeout: 30_000 }).toBe(2);
	expect(mailPings()[1].title).toBe(`North Pole Mail: ${familyOf(kid)}`);
	expect(JSON.stringify(mailPings()[1])).not.toContain('drum');
	expect(JSON.stringify(mailPings()[1])).not.toContain(kidFirst);

	// The kid's own profile does not get the slip.
	await actAs(parentPage, kidFirst);
	await parentPage.goto('/mail');
	await expect(parentPage.getByText('A small drum kit')).toHaveCount(0);

	await actAs(parentPage, parentUser[0].toUpperCase() + parentUser.slice(1));
	await parentPage.goto('/mail');
	await parentPage.getByLabel('A note back (optional)').fill('Please, no drums.');
	await parentPage.getByRole('button', { name: 'Decline' }).click();
	await expect(parentPage.getByRole('status').first()).toContainText('Declined');
	await parentContext.close();

	await santaPage.goto('/mail');
	await expect(santaPage.getByText('Please, no drums.')).toBeVisible();
	await santaPage.goto('/my-person');
	await expect(santaPage.locator('.chip-bad', { hasText: 'Not approved' })).toBeVisible();
	await santaContext.close();
});

test('Santa rests gracefully when no API key is set', async ({ browser }) => {
	const { context, page } = await signIn(browser, 'walt', PHONE);
	await page.goto('/santa');
	await shot(page, '21-santa-empty-phone');
	await page.getByLabel('Message to Santa').fill('Who drew me?');
	await page.getByRole('button', { name: 'Send' }).click();
	await expect(page.getByText("workshop line isn't connected")).toBeVisible();
	await shot(page, '22-santa-resting-phone');
	await context.close();
});

test('the Reminder Desk builds text links, and kids go to their parents', async ({ browser }) => {
	const { context, page } = await signIn(browser, 'morgan');
	await page.goto('/admin/reminders');
	await shot(page, '23-admin-reminders', true);
	await expect(page.getByText('Coming up')).toBeVisible();

	// Send the first planned list reminder to the desk right away.
	const first = page.locator('.list li').first();
	await first.locator('summary').click();
	await first.getByRole('button', { name: 'Send to the desk now' }).click();
	await expect(page.locator('a.ready').first()).toBeVisible();
	await page.locator('a.ready').first().click();
	await page.waitForURL(/\/admin\/reminders\/\d+/);

	const textLinks = page.locator('a[href^="sms:"]');
	expect(await textLinks.count()).toBeGreaterThan(0);
	const href = await textLinks.first().getAttribute('href');
	expect(href).toMatch(/^sms:\+\d+\?&body=/);
	await shot(page, '24-reminder-desk', true);
	await context.close();
});

test('the admin can add a countdown and create an invite link', async ({ browser }) => {
	const { context, page } = await signIn(browser, 'morgan');
	await page.goto('/admin/countdowns');
	await page.getByLabel('Type', { exact: true }).last().selectOption('custom');
	await page.getByLabel('Name', { exact: true }).last().fill('Wrapping party');
	await page.getByLabel('Date and time').last().fill('2030-12-20T18:00');
	await page.getByRole('button', { name: 'Add countdown' }).click();
	await expect(page.getByRole('heading', { name: 'Wrapping party' })).toBeVisible();
	await shot(page, '25-admin-countdowns', true);

	await page.goto('/admin/people');
	await page.locator('tr', { has: page.locator('strong', { hasText: 'June Snow' }) }).getByRole('link', { name: 'Edit' }).click();
	await page.getByRole('button', { name: 'Create a password reset link' }).click();
	const link = await page.locator('.invite code').innerText();
	expect(link).toMatch(/\/invite\//);
	await shot(page, '26-admin-person', true);
	await context.close();

	// The invite link sets a new password and signs them in.
	const fresh = await browser.newContext();
	const invitee = await fresh.newPage();
	await invitee.goto(link.replace(/^https?:\/\/[^/]+/, ''));
	await expect(invitee.getByText('Ho ho ho, June!')).toBeVisible();
	await shot(invitee, '27-invite');
	await invitee.getByLabel('Choose a password').fill(PASSWORD);
	await invitee.getByLabel('Type it again').fill(PASSWORD);
	await invitee.getByRole('button', { name: "I'm ready" }).click();
	await invitee.waitForURL('/');

	// The link only works once.
	const again = await fresh.newPage();
	await again.goto(link.replace(/^https?:\/\/[^/]+/, ''));
	await expect(again.getByText('This invite has melted')).toBeVisible();
	await fresh.close();
});

test('a large photo uploads, and only signed-in family can fetch it', async ({ browser, request }) => {
	const { context, page } = await signIn(browser, 'morgan');
	await page.goto('/admin/people');
	await page.locator('tr', { has: page.locator('strong', { hasText: 'Casey Frost' }) }).getByRole('link', { name: 'Edit' }).click();

	// A real PNG header followed by padding, well over the default 512 KB limit. An admin upload
	// skips the browser-side shrink, so this reaches the server at full size.
	const header = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082', 'hex');
	const big = Buffer.concat([header, Buffer.alloc(1_200_000)]);
	await page.locator('input[type="file"]').setInputFiles({ name: 'casey.png', mimeType: 'image/png', buffer: big });
	await page.getByRole('button', { name: 'Upload' }).click();
	await expect(page.getByRole('status')).toContainText('Photo saved');

	// A file that only claims to be an image is refused.
	await page.locator('input[type="file"]').setInputFiles({ name: 'evil.png', mimeType: 'image/png', buffer: Buffer.from('<svg onload=alert(1)>') });
	await page.getByRole('button', { name: 'Upload' }).click();
	await expect(page.getByRole('status')).toContainText('JPG, PNG, or WebP');

	const src = await page.locator('.head image').getAttribute('href');
	expect(src).toMatch(/^\/media\//);
	const signedIn = await page.request.get(src!);
	expect(signedIn.status()).toBe(200);
	const anonymous = await request.get(src!);
	expect(anonymous.status()).toBe(401);
	await context.close();
});

test("a parent can check what's covered on their kid's list, and it stays hidden by default", async ({ browser }) => {
	const [santaName, kid] = [...draws].find(([giver, receiver]) => /^(Casey|Riley|June|Walt)/.test(giver) && /Ivy|Theo|Poppy|Max/.test(receiver))!
		?? [...draws].find(([, receiver]) => /Ivy|Theo|Poppy|Max/.test(receiver))!;
	const kidParents: Record<string, string> = { Ivy: 'morgan', Theo: 'morgan', Poppy: 'jordan', Max: 'jordan' };
	const first = santaName.split(' ')[0];
	const santaUser = kidParents[first] ?? first.toLowerCase();

	const { context: santaContext, page: santaPage } = await signIn(browser, santaUser);
	if (['morgan', 'jordan'].includes(santaUser)) await actAs(santaPage, first);
	await santaPage.goto('/my-person');
	await santaPage.getByRole('button', { name: 'I bought this' }).first().click();
	await expect(santaPage.getByRole('status').first()).toContainText('Marked as bought');
	await santaContext.close();

	const kidFirst = kid.split(' ')[0];
	const { context, page } = await signIn(browser, kidParents[kidFirst]);
	await actAs(page, kidFirst);
	await page.goto('/my-list');
	await expect(page.getByText('Someone has this covered')).toHaveCount(0);
	await page.getByLabel(/Grown-ups only/).check();
	await expect(page.getByText('Someone has this covered')).toHaveCount(1);
	await expect(page.locator('main')).not.toContainText(santaName);
	await shot(page, '31-parent-covered', true);
	await context.close();
});

test('signing out is one menu away, from every kind of page', async ({ browser }) => {
	const { context, page } = await signIn(browser, 'walt', PHONE);
	await page.locator('summary.profile-chip').click();
	await shot(page, '32-profile-menu-phone');
	await expect(page.locator('.menu-panel').getByRole('link', { name: 'Your account' })).toBeVisible();
	await page.getByRole('button', { name: 'Sign out' }).click();
	await page.waitForURL(/\/login/);
	// The session is really gone, not just the page.
	await page.goto('/my-list');
	await expect(page).toHaveURL(/\/login/);
	await context.close();

	const parent = await signIn(browser, 'morgan');
	await expect(parent.page).toHaveURL(/\/profiles/);
	await parent.page.getByRole('button', { name: 'Sign out' }).click();
	await parent.page.waitForURL(/\/login/);
	await parent.context.close();

	const admin = await signIn(browser, 'morgan');
	await admin.page.goto('/admin');
	await admin.page.getByRole('button', { name: 'Sign out' }).click();
	await admin.page.waitForURL(/\/login/);
	await admin.context.close();
});

test('panels stay readable when they scroll over the snowbank', async ({ browser }) => {
	const { context, page } = await signIn(browser, 'walt', PHONE);
	await page.goto('/my-person');
	await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
	await page.waitForTimeout(500);
	await shot(page, '33-snow-my-person-phone');

	await page.setViewportSize(DESKTOP);
	await page.goto('/');
	await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
	await page.waitForTimeout(500);
	await shot(page, '34-snow-home-desktop');

	// Measures the panel's real color against the brightest thing behind it: pure white snow.
	const ratio = await page.locator('.link-card').first().evaluate((element) => {
		const parts = getComputedStyle(element).backgroundColor.match(/[\d.]+/g)!.map(Number);
		const alpha = parts[3] ?? 1;
		const over = (channel: number) => channel * alpha + 255 * (1 - alpha);
		const linear = (channel: number) => {
			const value = channel / 255;
			return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
		};
		const luminance = 0.2126 * linear(over(parts[0])) + 0.7152 * linear(over(parts[1])) + 0.0722 * linear(over(parts[2]));
		return 1.05 / (luminance + 0.05);
	});
	expect(ratio, 'white text on a panel over white snow').toBeGreaterThan(4.5);
	await context.close();
});

test('settings save, and the fairness page explains the draw', async ({ browser }) => {
	const { context, page } = await signIn(browser, 'morgan');
	await page.goto('/admin/settings');
	await shot(page, '28-admin-settings', true);
	await page.getByLabel('Topic').fill('santa-test-topic');
	await page.getByRole('button', { name: 'Save' }).nth(1).click();
	await expect(page.getByRole('status')).toContainText('Saved');

	await page.goto('/fairness');
	await expect(page.getByText("Santa's seal")).toBeVisible();
	await expect(page.locator('.prints code').first()).toBeVisible();
	await shot(page, '29-fairness', true);
	await context.close();
});

test('the big reveal shows every pair, and the seal checks out in the browser', async ({ browser }) => {
	const { context, page } = await signIn(browser, 'morgan');

	// Before publishing, nobody can see it, including the admin.
	await page.goto('/reveal');
	await expect(page.getByText('Not yet!')).toBeVisible();

	await page.goto('/admin/season');
	page.on('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Publish the reveal' }).click();
	await expect(page.getByRole('status')).toContainText('big reveal is live');

	await page.goto('/reveal');
	await expect(page.locator('.pair')).toHaveCount(10);
	for (const [giver, receiver] of draws) {
		await expect(page.locator('.pair', { hasText: giver.split(' ')[0] }).filter({ hasText: receiver.split(' ')[0] }).first()).toBeVisible();
	}
	await page.getByRole('button', { name: 'Check the seal' }).click();
	await expect(page.getByText('The seal is intact')).toBeVisible();
	await shot(page, '30-reveal', true);
	await context.close();
});
