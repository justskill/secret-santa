/**
 * Builds the zip that goes on the server. See "Making changes later" in README.md.
 *
 *   npm run release                  Next patch version, so 1.0.0 becomes 1.0.1
 *   npm run release -- 1.2.0         A version you choose
 *   npm run release -- --keep        Rebuild the current version
 *   npm run release -- --skip-tests  Skips the tests, for trying something out
 *
 * The zip goes in dist/. The image inside it is the exact one the tests ran against.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildZip, checkForSecrets, root } from './lib/package.mjs';

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const skipTests = args.includes('--skip-tests');
const chosen = args.find((arg) => /^\d+\.\d+\.\d+$/.test(arg));
const unknown = args.filter((arg) => arg !== '--keep' && arg !== '--skip-tests' && arg !== chosen);
if (unknown.length || (keep && chosen)) {
	console.error('Usage: npm run release -- [1.2.3 | --keep] [--skip-tests]');
	process.exit(1);
}

const packageFile = join(root, 'package.json');
const lockFile = join(root, 'package-lock.json');
const packageBefore = readFileSync(packageFile, 'utf8');
const lockBefore = readFileSync(lockFile, 'utf8');
const current = JSON.parse(packageBefore).version;
const nextPatch = current.replace(/(\d+)$/, (patch) => String(Number(patch) + 1));
const version = chosen ?? (keep ? current : nextPatch);
const image = `secret-santa:${version}`;
const zipPath = join(root, 'dist', `secret-santa-${version}.zip`);

function run(label, command, commandArgs, env = {}) {
	console.log(`\n=== ${label} ===`);
	const started = Date.now();
	// npm is a .cmd file on Windows, and those only run through a shell.
	const result = spawnSync(command, commandArgs, {
		cwd: root,
		stdio: 'inherit',
		env: { ...process.env, ...env },
		shell: process.platform === 'win32' && command !== 'docker' && command !== process.execPath
	});
	if (result.status !== 0) throw new Error(`${label} failed.`);
	console.log(`(${Math.round((Date.now() - started) / 1000)}s)`);
}

function setVersion(next) {
	const updated = JSON.parse(packageBefore);
	updated.version = next;
	writeFileSync(packageFile, `${JSON.stringify(updated, null, 2)}\n`);
	const lock = JSON.parse(lockBefore);
	lock.version = next;
	lock.packages[''].version = next;
	writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
}

try {
	if (version !== current) {
		console.log(`Version ${current} becomes ${version}.`);
		setVersion(version);
	}
	if (!skipTests) {
		run('Unit tests', 'npm', ['test']);
		run('Type checks', 'npm', ['run', 'check']);
		run('Production build', 'npm', ['run', 'build']);
		run('Browser tests', 'npm', ['run', 'test:e2e']);
	}
	run('Building the image', 'docker', ['build', '--platform', 'linux/amd64', '--provenance=false', '-t', image, '.']);
	if (!skipTests) run('Testing the image', process.execPath, [join('scripts', 'docker-smoke.mjs')], { SMOKE_IMAGE: image });

	console.log('\n=== Packaging ===');
	checkForSecrets(image);
	mkdirSync(join(root, 'dist'), { recursive: true });
	const size = await buildZip({ version, image, zipPath });
	console.log(`\nDone: ${zipPath} (${Math.round(size / 1_000_000)} MB)`);
	console.log('To check it the way a server would use it: npm run test:deploy');
} catch (err) {
	// A failed release shouldn't use up a version number.
	writeFileSync(packageFile, packageBefore);
	writeFileSync(lockFile, lockBefore);
	console.error(`\n${err instanceof Error ? err.message : err}`);
	process.exit(1);
}
