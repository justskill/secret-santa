import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Local development reads .env; in the container the variables come from compose.
// loadEnvFile never overrides a variable that is already set.
if (existsSync('.env')) {
	try {
		process.loadEnvFile('.env');
	} catch {
		// A malformed .env should not stop the app from starting.
	}
}

export function dataDir(): string {
	const dir = resolve(process.env.DATA_DIR ?? './data');
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return dir;
}

export function mediaDir(): string {
	const dir = resolve(dataDir(), 'media');
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return dir;
}

export function backupDir(): string {
	const dir = resolve(dataDir(), 'backups');
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return dir;
}

/** The address family members use, for invite links and notification tap targets. */
export function publicUrl(fallback?: string): string {
	const configured = process.env.PUBLIC_URL ?? process.env.ORIGIN;
	return (configured ?? fallback ?? 'http://localhost:5173').replace(/\/+$/, '');
}

export function anthropicKey(): string | undefined {
	return process.env.ANTHROPIC_API_KEY?.trim() || undefined;
}

export function isDemoMode(): boolean {
	return process.env.DEMO_MODE === 'true' || process.env.DEMO_MODE === '1';
}
