import { defineConfig, devices } from '@playwright/test';

/**
 * Checks the real deployment path against a running container. scripts/docker-smoke.sh starts it,
 * supplies the first-run link, and restarts the container between the two phases.
 */
export default defineConfig({
	testDir: 'tests/docker',
	fullyParallel: false,
	workers: 1,
	timeout: 60_000,
	expect: { timeout: 10_000 },
	reporter: [['list']],
	use: { baseURL: process.env.BASE_URL ?? 'http://localhost:38471' },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
