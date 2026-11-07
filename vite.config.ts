import { sveltekit } from '@sveltejs/kit/vite';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

export default defineConfig({
	plugins: [sveltekit()],
	define: { __APP_VERSION__: JSON.stringify(version) },
	test: {
		include: ['tests/unit/**/*.test.ts'],
		environment: 'node',
		// Each test file gets its own temporary database, so files must not share a process.
		pool: 'forks',
		setupFiles: ['tests/unit/setup.ts']
	}
});
