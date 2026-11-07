import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';
import { create as createTar } from 'tar';
import yazl from 'yazl';

export const root = fileURLToPath(new URL('../..', import.meta.url));

/**
 * What goes in the source copy inside the zip. This is a list of what to include, rather than what
 * to leave out, so a stray file with a secret in it can't ship by accident.
 */
const SOURCE_ENTRIES = [
	'.dockerignore',
	'.env.example',
	'.gitattributes',
	'.gitignore',
	'Dockerfile',
	'README.md',
	'package.json',
	'package-lock.json',
	'playwright.config.ts',
	'playwright.docker.config.ts',
	'playwright.live.config.ts',
	'svelte.config.js',
	'tsconfig.json',
	'vite.config.ts',
	'assets',
	'deploy',
	'scripts',
	'src',
	'static',
	'tests'
];

/** Things in the project folder that are expected not to ship. */
const LOCAL_ONLY = new Set(['.claude', '.env', '.git', '.svelte-kit', 'build', 'data', 'dist', 'node_modules', 'playwright-report', 'test-results']);

const isLocalJunk = (path) => /(^|[\\/])(\.DS_Store|Thumbs\.db)$/.test(path) || /(^|[\\/])\.env(\.(?!example$)[^\\/]*)?$/.test(path) || /\.db(-shm|-wal)?$/.test(path);

function walk(path, found = []) {
	if (statSync(path).isDirectory()) {
		for (const name of readdirSync(path)) walk(join(path, name), found);
	} else {
		found.push(path);
	}
	return found;
}

/** The values in the local .env that must never leave this machine. */
function localSecrets() {
	const file = join(root, '.env');
	if (!existsSync(file)) return [];
	const secrets = [];
	for (const match of readFileSync(file, 'utf8').matchAll(/^(ANTHROPIC_API_KEY|SANTA_SECRET)=(.+)$/gm)) {
		const value = match[2].trim().replace(/^["']|["']$/g, '');
		if (value) secrets.push(value);
	}
	return secrets;
}

function warnAboutUnlistedFiles() {
	const unlisted = readdirSync(root).filter((name) => !SOURCE_ENTRIES.includes(name) && !LOCAL_ONLY.has(name) && !name.startsWith('.env'));
	if (unlisted.length) {
		console.warn(`Not in the source copy, because scripts/lib/package.mjs doesn't list them: ${unlisted.join(', ')}`);
	}
}

/** Stops the release if a secret from .env turned up in anything that ships. */
export function checkForSecrets(image) {
	const secrets = localSecrets();
	const files = SOURCE_ENTRIES.flatMap((entry) => (existsSync(join(root, entry)) ? walk(join(root, entry)) : []));
	for (const secret of secrets) {
		const hit = files.find((file) => !isLocalJunk(file) && readFileSync(file).includes(secret));
		if (hit) throw new Error(`A secret from your .env is in ${relative(root, hit)}. Remove it before releasing.`);
		// The value goes in through the environment, so it isn't in any command line or log.
		const search = spawnSync('docker', ['run', '--rm', '-e', 'NEEDLE', '--entrypoint', 'sh', image, '-c', 'grep -rlF -e "$NEEDLE" /app /data 2>/dev/null'], {
			env: { ...process.env, NEEDLE: secret },
			encoding: 'utf8',
			maxBuffer: 16 * 1024 * 1024
		});
		if (search.status === 0) throw new Error(`A secret from your .env is inside the image, in ${search.stdout.trim()}. Nothing was packaged.`);
	}
}

async function saveImage(image, path, level) {
	const save = spawn('docker', ['save', image], { stdio: ['ignore', 'pipe', 'inherit'] });
	const finished = new Promise((resolve, reject) => {
		save.on('error', reject);
		save.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`docker save exited with code ${code}`))));
	});
	await pipeline(save.stdout, createGzip({ level }), createWriteStream(path));
	await finished;
}

const lf = (text) => text.replace(/\r\n/g, '\n');

/**
 * Builds the zip for the server. Everything unpacks into one folder, whose name doesn't change
 * between versions, so an update lands on top of the last one and keeps its .env and backups.
 */
export async function buildZip({ version, image, zipPath, gzipLevel = 6 }) {
	warnAboutUnlistedFiles();
	const work = mkdtempSync(join(tmpdir(), 'santa-release-'));
	try {
		const imageFile = join(work, 'image.tar.gz');
		const sourceFile = join(work, 'source.tar.gz');
		await saveImage(image, imageFile, gzipLevel);
		await createTar(
			{
				gzip: true,
				portable: true,
				cwd: root,
				file: sourceFile,
				filter: (path) => !isLocalJunk(path)
			},
			SOURCE_ENTRIES.filter((entry) => existsSync(join(root, entry)))
		);

		const zip = new yazl.ZipFile();
		const folder = 'secret-santa';
		const text = (name, content, mode = 0o100644) => zip.addBuffer(Buffer.from(lf(content)), `${folder}/${name}`, { mode });
		const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
		text('deploy.sh', read('deploy', 'deploy.sh'), 0o100755);
		text('compose.yaml', read('deploy', 'compose.yaml'));
		text('DEPLOY.md', read('deploy', 'DEPLOY.md'));
		text('.env.example', read('.env.example'));
		text('VERSION', `${version}\n`);
		// Already compressed, so storing them as they are saves time and nothing else.
		zip.addFile(imageFile, `${folder}/image-amd64.tar.gz`, { compress: false, mode: 0o100644 });
		zip.addFile(sourceFile, `${folder}/source.tar.gz`, { compress: false, mode: 0o100644 });
		zip.end();
		await pipeline(zip.outputStream, createWriteStream(zipPath));
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
	return statSync(zipPath).size;
}
