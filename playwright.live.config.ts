import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 4174;

/**
 * Talks to the real Claude API using the key in .env, so each run costs real money (well under a
 * dollar). Run it on purpose with: npx playwright test --config playwright.live.config.ts
 */
export default defineConfig({
	testDir: 'tests/live',
	fullyParallel: false,
	workers: 1,
	timeout: 240_000,
	expect: { timeout: 90_000 },
	reporter: [['list']],
	use: { baseURL: `http://localhost:${PORT}` },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'node build/index.js',
		url: `http://localhost:${PORT}/healthz`,
		reuseExistingServer: false,
		timeout: 30_000,
		stdout: 'pipe',
		stderr: 'pipe',
		env: {
			PORT: String(PORT),
			ORIGIN: `http://localhost:${PORT}`,
			DATA_DIR: join(tmpdir(), `santa-live-${Date.now()}`),
			DEMO_MODE: 'true',
			TZ: 'America/Chicago'
		}
	}
});
