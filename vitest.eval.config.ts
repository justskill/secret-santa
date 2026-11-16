import { sveltekit } from '@sveltejs/kit/vite';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

/**
 * The scored Santa eval. It calls the real Claude API with the key in .env, so it costs real money
 * and never runs with `npm test`. Run it on purpose with `npm run eval`; see tests/eval/README.md.
 */
export default defineConfig({
	plugins: [sveltekit()],
	define: { __APP_VERSION__: JSON.stringify(version) },
	test: {
		include: ['tests/eval/**/*.eval.ts'],
		environment: 'node',
		pool: 'forks',
		setupFiles: ['tests/eval/setup.ts'],
		testTimeout: 3 * 60 * 60 * 1000,
		hookTimeout: 10 * 60 * 1000,
		reporters: ['default']
	}
});
