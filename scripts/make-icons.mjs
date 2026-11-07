// Renders static/favicon.svg to the PNG sizes that phones use for home screen icons.
// Only needed if the icon artwork changes: node scripts/make-icons.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const svg = readFileSync('static/favicon.svg', 'utf8');
const browser = await chromium.launch();

for (const size of [192, 512]) {
	const page = await browser.newPage({ viewport: { width: size, height: size } });
	await page.setContent(
		`<!doctype html><style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
	);
	await page.screenshot({ path: `static/icon-${size}.png`, omitBackground: true });
	await page.close();
	console.log(`static/icon-${size}.png`);
}

await browser.close();
