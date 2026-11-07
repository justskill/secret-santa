import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 4173;
const dataDir = join(tmpdir(), `santa-e2e-${Date.now()}`);

/**
 * Runs the production build against a throwaway demo family, with no API key, so these tests are
 * free and repeatable. Anything that needs a real model lives in tests/live.
 */
export default defineConfig({
	testDir: 'tests/e2e',
	fullyParallel: false,
	workers: 1,
	timeout: 90_000,
	expect: { timeout: 10_000 },
	reporter: [['list']],
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
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
			DATA_DIR: dataDir,
			DEMO_MODE: 'true',
			ANTHROPIC_API_KEY: '',
			BODY_SIZE_LIMIT: '8M',
			TZ: 'America/Chicago'
		}
	}
});
