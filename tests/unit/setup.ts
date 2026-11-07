import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every test file runs against its own throwaway data folder and never touches real data or the
// Anthropic API. The empty key makes all Santa writing fall back to its no-AI path.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'santa-test-'));
process.env.ANTHROPIC_API_KEY = '';
process.env.PUBLIC_URL = 'https://santa.test';
process.env.TZ = 'America/Chicago';
