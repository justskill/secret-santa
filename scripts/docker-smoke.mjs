/**
 * Checks the image the way a real install uses it: first-run setup, sealing, photo uploads, and that
 * all data survives replacing the container. Uses its own throwaway container and volume.
 *
 * Builds the image unless SMOKE_IMAGE names one to test instead, which is how a release tests the
 * exact image it's about to ship.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { root } from './lib/package.mjs';

const NAME = 'santa-smoke';
const VOLUME = 'santa-smoke-data';
const PORT = 38471;
const BASE_URL = `http://localhost:${PORT}`;
const image = process.env.SMOKE_IMAGE ?? 'secret-santa:latest';

function docker(...args) {
	return spawnSync('docker', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function logs() {
	const result = docker('logs', NAME);
	return `${result.stdout}${result.stderr}`;
}

function cleanup() {
	docker('rm', '-f', NAME);
	docker('volume', 'rm', VOLUME);
}

function fail(message) {
	console.error(message);
	console.error(`--- Container log ---\n${logs().split('\n').slice(-30).join('\n')}`);
	cleanup();
	process.exit(1);
}

async function start() {
	const run = docker('run', '-d', '--name', NAME, '-p', `${PORT}:3000`, '-e', `ORIGIN=${BASE_URL}`, '-v', `${VOLUME}:/data`, image);
	if (run.status !== 0) fail(`The container did not start:\n${run.stderr}`);
	for (let attempt = 0; attempt < 40; attempt++) {
		try {
			if ((await fetch(`${BASE_URL}/healthz`)).ok) return;
		} catch {
			// Not answering yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	fail('The container did not become healthy.');
}

function browserTests(env) {
	const result = spawnSync('npx', ['playwright', 'test', '--config', 'playwright.docker.config.ts'], {
		cwd: root,
		stdio: 'inherit',
		env: { ...process.env, BASE_URL, ...env },
		shell: process.platform === 'win32'
	});
	if (result.status !== 0) fail('The browser tests failed.');
}

cleanup();

if (!process.env.SMOKE_IMAGE) {
	const build = docker('build', '--progress=plain', '-t', image, '.');
	if (build.status !== 0) {
		console.error(`Docker build failed:\n${`${build.stdout}${build.stderr}`.split('\n').slice(-30).join('\n')}`);
		process.exit(1);
	}
}
console.log(`Testing ${image}, ${docker('images', image, '--format', '{{.Size}}').stdout.trim()}`);

await start();

const setupUrl = logs().match(/First-run setup link: (\S+)/)?.[1];
if (!setupUrl) fail('There is no first-run setup link in the logs.');
console.log('Found the first-run link in the logs.');

const contents = docker('exec', NAME, 'sh', '-c', 'ls -a /app; echo "user: $(id -un)"; test ! -e /app/.env && echo "no .env in the image"; test ! -d /app/tests && echo "no tests in the image"; ls -la /data | sed -n "1,12p"');
console.log(`--- Image contents ---\n${contents.stdout}`);
if (!contents.stdout.includes('no .env in the image')) fail('The image contains a .env file.');

browserTests({ PHASE: 'setup', SETUP_URL: setupUrl });

console.log('--- Replacing the container ---');
docker('rm', '-f', NAME);
await start();
browserTests({ PHASE: 'restart' });

const composeCheck = spawnSync('docker', ['compose', '-f', join('deploy', 'compose.yaml'), 'config', '-q'], {
	cwd: root,
	encoding: 'utf8',
	env: { ...process.env, ORIGIN: 'https://santa.example.com' }
});
if (composeCheck.status !== 0) fail(`deploy/compose.yaml is not valid:\n${composeCheck.stderr}`);
console.log('deploy/compose.yaml is valid.');

cleanup();
console.log('The image passed.');
