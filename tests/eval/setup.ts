import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The eval builds its family in a throwaway data folder and never touches real data. Unlike the
// unit tests it keeps ANTHROPIC_API_KEY: src/lib/server/env.ts reads it from .env or the shell.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'santa-eval-'));
process.env.PUBLIC_URL = 'https://santa.test';
process.env.TZ = 'America/Chicago';
