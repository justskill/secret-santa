import { expect, test } from '@playwright/test';

const PHASE = process.env.PHASE ?? 'setup';
const SETUP_URL = process.env.SETUP_URL ?? '';
const USERNAME = 'headelf';
const PASSWORD = 'correct horse battery';

async function signIn(page: import('@playwright/test').Page) {
	await page.goto('/login');
	await page.getByLabel('Your name').fill(USERNAME);
	await page.getByLabel('Password').fill(PASSWORD);
	await page.getByRole('button', { name: 'Come on in' }).click();
	await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

test.describe.configure({ mode: 'serial' });

test.describe('first run', () => {
	test.skip(PHASE !== 'setup');

	test('nobody can claim a new install without the code from the log', async ({ page }) => {
		await page.goto('/setup');
		await page.getByLabel('Setup code').fill('wrong-code');
		await page.getByLabel('Your name').fill('Intruder');
		await page.getByLabel('Sign-in name').fill('intruder');
		await page.getByLabel('Password').fill('a long enough password');
		await page.getByRole('button', { name: 'Open the workshop' }).click();
		await expect(page.getByRole('alert')).toContainText("isn't right");
	});

	test('the setup link creates the admin and opens the workshop', async ({ page }) => {
		expect(SETUP_URL).toContain('/setup?token=');
		await page.goto(SETUP_URL);
		await expect(page.getByLabel('Setup code')).not.toHaveValue('');
		await page.getByLabel('Family name').fill('The Test Family');
		await page.getByLabel('Your name').fill('Head Elf');
		await page.getByLabel('Sign-in name').fill(USERNAME);
		await page.getByLabel('Password').fill(PASSWORD);
		await page.getByRole('button', { name: 'Open the workshop' }).click();
		await page.waitForURL('/admin');
		await expect(page.getByRole('heading', { name: /Christmas/ })).toBeVisible();
		await expect(page.getByText('The Test Family')).toBeVisible();
	});

	test('setup closes for good once an admin exists', async ({ page }) => {
		await page.goto(SETUP_URL);
		await expect(page).toHaveURL(/\/login/);
	});

	test('impossible rules are explained, and a workable family can seal', async ({ page }) => {
		await signIn(page);
		const add = async (name: string, kind: 'Adult' | 'Kid', household?: string) => {
			await page.goto('/admin/people');
			await page.getByLabel('Name', { exact: true }).fill(name);
			await page.getByLabel(kind === 'Adult' ? /Adult, with their own login/ : /Kid, whose parents/).check();
			if (household) await page.getByLabel('Or start a new household').fill(household);
			if (kind === 'Kid') await page.getByLabel('Pat Parent').check();
			await page.getByRole('button', { name: 'Add to the family' }).click();
			await expect(page.getByRole('status').first()).toContainText('is on the list');
		};
		await add('Pat Parent', 'Adult', 'The Parents');
		await page.goto('/admin/people');
		await page.getByLabel('Name', { exact: true }).fill('Kit Kid');
		await page.getByLabel(/Kid, whose parents/).check();
		await page.getByLabel('Household', { exact: true }).selectOption({ label: 'The Parents' });
		await page.getByLabel('Pat Parent').check();
		await page.getByRole('button', { name: 'Add to the family' }).click();
		await expect(page.getByRole('status').first()).toContainText('is on the list');

		// Pat and Kit can only draw the admin, so the rules cannot be satisfied yet.
		await page.goto('/admin/season');
		await expect(page.getByText('do not have enough different names')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Seal the names' })).toHaveCount(0);

		await add('Quinn Other', 'Adult');
		await page.goto('/admin/season');
		await expect(page.getByText('The rules work')).toBeVisible();
		await page.getByRole('button', { name: 'Seal the names' }).click();
		await page.getByRole('button', { name: 'Yes, seal the names' }).click();
		await expect(page.getByText('Published fingerprint')).toBeVisible();
	});

	test('a large photo fits within the upload limit set in the image', async ({ page }) => {
		await signIn(page);
		await page.goto('/admin/people');
		await page.locator('tr', { has: page.locator('strong', { hasText: 'Quinn Other' }) }).getByRole('link', { name: 'Edit' }).click();
		const header = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082', 'hex');
		await page.locator('input[type="file"]').setInputFiles({ name: 'q.png', mimeType: 'image/png', buffer: Buffer.concat([header, Buffer.alloc(3_000_000)]) });
		await page.getByRole('button', { name: 'Upload' }).click();
		await expect(page.getByRole('status')).toContainText('Photo saved');
	});

	test('the reveal works in the container, and the page loads with no blocked content', async ({ page }) => {
		const problems: string[] = [];
		page.on('console', (message) => {
			if (message.type() === 'error') problems.push(message.text());
		});
		await signIn(page);
		await page.goto('/draw');
		const gift = page.locator('button.gift');
		await gift.hover();
		await page.mouse.down();
		await page.waitForTimeout(2500);
		await page.mouse.up();
		await expect(page.locator('.result-card')).toBeVisible({ timeout: 12_000 });
		const name = await page.locator('.result-card h1').innerText();
		process.stdout.write(`drew: ${name.length ? 'a name' : 'nothing'}\n`);
		expect(problems, problems.join('\n')).toEqual([]);
	});
});

test.describe('after a restart', () => {
	test.skip(PHASE !== 'restart');

	test('everything survives, including the sealed draw', async ({ page }) => {
		await signIn(page);
		await page.goto('/draw');
		await expect(page.locator('h1.winner')).toBeVisible();
		await page.goto('/admin/people');
		await expect(page.getByRole('cell', { name: /Quinn Other/ })).toBeVisible();
		const photo = page.locator('tr', { has: page.locator('strong', { hasText: 'Quinn Other' }) }).locator('image');
		const href = await photo.getAttribute('href');
		expect((await page.request.get(href!)).status()).toBe(200);
		await page.goto('/fairness');
		await expect(page.locator('.prints code').first()).toBeVisible();
	});
});
