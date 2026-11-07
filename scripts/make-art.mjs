// Turns the full-size painting in assets/art into the small files the app serves, and the home
// screen icons. Only needed if the artwork changes: node scripts/make-art.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const source = `data:image/png;base64,${readFileSync('assets/art/santa-portrait.png').toString('base64')}`;
mkdirSync('static/art', { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();

/**
 * Resizes in the browser, and tidies the cut-out edge along the way: the original has a thin, bright
 * fringe left over from background removal, so pixels on the edge take their color from solid pixels
 * just inside them, and the edge is softened.
 */
const render = (size, options) =>
	page.evaluate(
		async ({ source, size, options }) => {
			const image = new Image();
			image.src = source;
			await image.decode();

			const work = document.createElement('canvas');
			work.width = work.height = size * 2;
			const workContext = work.getContext('2d');
			workContext.imageSmoothingQuality = 'high';
			workContext.drawImage(image, 0, 0, work.width, work.height);
			const pixels = workContext.getImageData(0, 0, work.width, work.height);
			const { data, width, height } = pixels;

			const original = new Uint8ClampedArray(data);
			const alphaAt = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : original[(y * width + x) * 4 + 3]);
			for (let y = 0; y < height; y++) {
				for (let x = 0; x < width; x++) {
					const i = (y * width + x) * 4;
					if (original[i + 3] === 0) continue;
					let minimum = 255;
					for (let dy = -2; dy <= 2; dy++) {
						for (let dx = -2; dx <= 2; dx++) minimum = Math.min(minimum, alphaAt(x + dx, y + dy));
					}
					if (minimum === 255) continue;
					// An edge pixel: borrow the color of the nearest solid pixel, then fade it out.
					let found = false;
					for (let radius = 3; radius <= 7 && !found; radius++) {
						for (let dy = -radius; dy <= radius && !found; dy++) {
							for (let dx = -radius; dx <= radius && !found; dx++) {
								if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
								if (alphaAt(x + dx, y + dy) === 255) {
									const j = ((y + dy) * width + x + dx) * 4;
									data[i] = original[j];
									data[i + 1] = original[j + 1];
									data[i + 2] = original[j + 2];
									found = true;
								}
							}
						}
					}
					data[i + 3] = Math.round((minimum / 255) * original[i + 3]);
				}
			}
			workContext.putImageData(pixels, 0, 0);

			const out = document.createElement('canvas');
			out.width = out.height = size;
			const context = out.getContext('2d');
			context.imageSmoothingQuality = 'high';
			if (options.background) {
				context.fillStyle = options.background;
				context.fillRect(0, 0, size, size);
				const inset = Math.round(size * 0.08);
				context.drawImage(work, inset, inset, size - inset * 2, size - inset * 2);
			} else {
				context.drawImage(work, 0, 0, size, size);
			}
			return out.toDataURL(options.type, options.quality);
		},
		{ source, size, options }
	);

const save = (path, dataUrl) => {
	const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
	writeFileSync(path, bytes);
	console.log(path, `${Math.round(bytes.length / 1024)} KB`);
};

save('static/art/santa.webp', await render(320, { type: 'image/webp', quality: 0.86 }));
save('static/icon-192.png', await render(192, { type: 'image/png', background: '#0b1a2b' }));
save('static/icon-512.png', await render(512, { type: 'image/png', background: '#0b1a2b' }));

await browser.close();
