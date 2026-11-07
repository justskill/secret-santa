/**
 * Tests the zip the way a server uses it, on a clean Docker inside a container: install, update,
 * an update that fails, rollback, backup, restore, and wiping test data. The family data from the
 * first-run tests has to survive all of it. Nothing touches Docker's real containers or volumes.
 *
 *   npm run test:deploy                    Tests the newest zip in dist/
 *   npm run test:deploy -- path/to/zip
 *   npm run test:deploy -- --source-build  Also builds from source, as a server with another CPU would
 *   npm run test:deploy -- --install-only  Only installs. Quick, for trying other Docker versions.
 *
 * Set DIND_IMAGE to try another Docker version, and SERVER_SHELL to try another shell.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildZip, root } from './lib/package.mjs';

const SERVER = 'santa-fake-server';
const PORT = 38472;
const BASE_URL = `http://localhost:${PORT}`;
const DIND_IMAGE = process.env.DIND_IMAGE ?? 'docker:29-dind';
const SERVER_SHELL = process.env.SERVER_SHELL ?? 'dash';

const args = process.argv.slice(2);
const sourceBuild = args.includes('--source-build');
const installOnly = args.includes('--install-only');
const zipArg = args.find((arg) => !arg.startsWith('--'));

function newestZip() {
	const dist = join(root, 'dist');
	const zips = existsSync(dist) ? readdirSync(dist).filter((name) => /^secret-santa-.*\.zip$/.test(name)) : [];
	const newest = zips.map((name) => join(dist, name)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
	if (!newest) throw new Error('There is no zip in dist/. Run: npm run release -- --keep');
	return newest;
}

const zipPath = zipArg ?? newestZip();
const version = zipPath.match(/secret-santa-(.+)\.zip$/)?.[1];
if (!version) throw new Error(`Can't tell the version from ${zipPath}`);
const work = mkdtempSync(join(tmpdir(), 'santa-deploy-test-'));
const testImages = [];
const results = [];

function docker(args, options = {}) {
	return spawnSync('docker', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
}

/** Runs a shell command on the fake server, in the folder the app was unzipped to. */
function onServer(command, input) {
	const result = docker(['exec', '-i', SERVER, 'sh', '-c', `cd /srv/secret-santa 2>/dev/null; ${command}`], { input: input ?? '' });
	return { ...result, output: `${result.stdout}${result.stderr}` };
}

const deployCommand = (args = '') => `${SERVER_SHELL} deploy.sh ${args}`;

function check(label, ok, detail = '') {
	results.push({ label, ok });
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
	if (!ok) {
		if (detail) console.log(`\n${detail}\n`);
		throw new Error(`Failed: ${label}`);
	}
}

function deploy(args, input) {
	const result = onServer(deployCommand(args), input);
	console.log(result.output.trim().split('\n').map((line) => `    | ${line}`).join('\n'));
	return result;
}

function runningVersion() {
	return onServer(`docker exec secret-santa node -p "require('/app/package.json').version"`).stdout.trim();
}

function browserTests(phase, setupUrl = '') {
	const result = spawnSync('npx', ['playwright', 'test', '--config', 'playwright.docker.config.ts'], {
		cwd: root,
		stdio: 'inherit',
		env: { ...process.env, BASE_URL, PHASE: phase, SETUP_URL: setupUrl },
		shell: process.platform === 'win32'
	});
	return result.status === 0;
}

const familyIsIntact = (when) => check(`the family, the draw, and photos are intact ${when}`, browserTests('restart'));

function setupLink(output) {
	return output.match(/(https?:\/\/\S+\/setup\?token=\S+)/)?.[1];
}

/** Makes a copy of the release image with a new version number and, optionally, a broken startup. */
function deriveImage(newVersion, command) {
	const tag = `secret-santa:${newVersion}`;
	const lines = [
		`FROM secret-santa:${version}`,
		'USER root',
		`RUN sed -i 's/"version": *"[^"]*"/"version": "${newVersion}"/' /app/package.json`,
		'USER node',
		...(command ? [`CMD ${JSON.stringify(command)}`] : [])
	];
	const build = docker(['build', '-t', tag, '-'], { input: `${lines.join('\n')}\n` });
	if (build.status !== 0) throw new Error(`Couldn't build a test image:\n${build.stderr}`);
	testImages.push(tag);
	return tag;
}

/** Puts a new zip on the fake server and unpacks it over the last one, as an update does. */
async function copyInZip(newVersion, image) {
	const path = join(work, `secret-santa-${newVersion}.zip`);
	await buildZip({ version: newVersion, image, zipPath: path, gzipLevel: 1 });
	docker(['cp', path, `${SERVER}:/srv/update.zip`]);
	const unpacked = docker(['exec', SERVER, 'sh', '-c', 'cd /srv && unzip -oq update.zip && rm update.zip']);
	check(`the ${newVersion} zip unpacks over the last one`, unpacked.status === 0, unpacked.stderr);
}

function stopServer() {
	docker(['rm', '-fv', SERVER]);
}

async function startServer() {
	stopServer();
	const start = docker(['run', '-d', '--privileged', '--name', SERVER, '-e', 'DOCKER_TLS_CERTDIR=', '-p', `${PORT}:3000`, DIND_IMAGE]);
	if (start.status !== 0) throw new Error(`Couldn't start the fake server:\n${start.stderr}`);
	for (let attempt = 0; attempt < 60; attempt++) {
		if (docker(['exec', SERVER, 'docker', 'info']).status === 0) break;
		if (attempt === 59) throw new Error(`Docker didn't start on the fake server:\n${docker(['logs', SERVER]).stderr}`);
		await new Promise((resolve) => setTimeout(resolve, 2000));
	}
	if (SERVER_SHELL !== 'sh') {
		const shell = docker(['exec', SERVER, 'apk', 'add', '--no-cache', SERVER_SHELL]);
		if (shell.status !== 0) throw new Error(`Couldn't install ${SERVER_SHELL}:\n${shell.stderr}`);
	}
	docker(['exec', SERVER, 'mkdir', '-p', '/srv']);
	const serverVersion = docker(['exec', SERVER, 'docker', 'version', '--format', '{{.Server.Version}}']).stdout.trim();
	console.log(`Fake server: Docker ${serverVersion}, running the script with ${SERVER_SHELL}.`);
}

async function main() {
	console.log(`Testing ${zipPath} (version ${version})`);
	await startServer();

	console.log('\n--- Unpacking ---');
	docker(['cp', zipPath, `${SERVER}:/srv/release.zip`]);
	check('the zip unpacks', docker(['exec', SERVER, 'sh', '-c', 'cd /srv && unzip -q release.zip']).status === 0);
	const listing = onServer('ls -a').stdout.split('\n');
	for (const file of ['deploy.sh', 'compose.yaml', 'DEPLOY.md', '.env.example', 'VERSION', 'image-amd64.tar.gz', 'source.tar.gz']) {
		check(`it contains ${file}`, listing.includes(file), listing.join(' '));
	}
	check('it contains no .env', !listing.includes('.env'));
	check('no file has Windows line endings', onServer(`grep -l "$(printf '\\r')" deploy.sh compose.yaml .env.example VERSION DEPLOY.md`).stdout.trim() === '');
	const sourceFiles = onServer('tar tzf source.tar.gz').stdout.split('\n');
	check('the source copy has what a build needs', ['Dockerfile', 'package-lock.json', 'src/hooks.server.ts'].every((file) => sourceFiles.includes(file)));
	check('the source copy has no .env or database', !sourceFiles.some((file) => /(^|\/)\.env$|\.db$|node_modules/.test(file)));

	console.log('\n--- First install, with a mistake in the address ---');
	for (const bad of ['santa.example.com', 'https://santa example.com']) {
		const rejected = deploy('', `${bad}\n`);
		check(`rejects the address "${bad}"`, rejected.status !== 0 && !onServer('ls -a').stdout.split('\n').includes('.env'));
	}

	console.log('\n--- First install ---');
	const install = deploy('', `${BASE_URL}/\n\n3000\nn\n`);
	check('the install succeeds', install.status === 0, install.output);
	check('the right version is running', runningVersion() === version, runningVersion());
	const firstLink = setupLink(install.output);
	check('it prints the first-run link', !!firstLink, install.output);
	check('the address lost its trailing slash', onServer('grep "^ORIGIN=" .env').stdout.trim() === `ORIGIN=${BASE_URL}`);
	check('.env is private', onServer('stat -c %a .env').stdout.trim() === '600');
	check('no port or key ended up wrong in .env', onServer('grep -E "^(HOST_PORT=3000|ANTHROPIC_API_KEY=)$" .env | wc -l').stdout.trim() === '2');
	const status = deploy('status');
	check('status still offers the first-run link, because no account exists yet', !!setupLink(status.output) && status.status === 0, status.output);
	if (installOnly) return;

	check('first-run setup works, and the family can seal a draw', browserTests('setup', firstLink));
	const afterSetup = deploy('status');
	check('status stops offering the link once an account exists', !setupLink(afterSetup.output) && afterSetup.status === 0, afterSetup.output);

	console.log('\n--- A normal update ---');
	const envBefore = onServer('cat .env').stdout;
	const nextVersion = `${version}-next`;
	await copyInZip(nextVersion, deriveImage(nextVersion));
	const update = deploy();
	check('the update succeeds', update.status === 0, update.output);
	check('the new version is running', runningVersion() === nextVersion, runningVersion());
	check('.env is untouched', onServer('cat .env').stdout === envBefore);
	check('a copy of the data was saved', /backups\/santa-\S+-before-\S+\.tar\.gz/.test(update.output), update.output);
	check('the copy is private', onServer('stat -c %a backups/*.tar.gz').stdout.trim() === '600');
	check('the copy includes the encryption key', onServer('tar tzf backups/*.tar.gz').stdout.includes('./secret.key'));
	familyIsIntact('after an update');

	console.log('\n--- Running it again changes nothing ---');
	const backupsBefore = onServer('ls backups | wc -l').stdout.trim();
	const again = deploy();
	check('running it again succeeds', again.status === 0, again.output);
	check('it says it is already installed', again.output.includes('already installed'), again.output);
	check('it saves no extra copy', onServer('ls backups | wc -l').stdout.trim() === backupsBefore);

	console.log('\n--- An update that crashes and scrambles the database ---');
	const brokenVersion = `${version}-broken`;
	await copyInZip(brokenVersion, deriveImage(brokenVersion, ['sh', '-c', 'echo scrambled > /data/santa.db; exit 1']));
	const broken = deploy();
	check('the script reports the failure', broken.status !== 0, broken.output);
	check('it says what happened', broken.output.includes('went back to version'), broken.output);
	check('the old version is running again', runningVersion() === nextVersion, runningVersion());
	familyIsIntact('after a crashing update');

	console.log('\n--- An update that starts but never answers ---');
	const hungVersion = `${version}-hung`;
	await copyInZip(hungVersion, deriveImage(hungVersion, ['node', '-e', 'setInterval(() => {}, 1000)']));
	const hungRun = onServer(`SANTA_HEALTH_WAIT_SECONDS=20 ${deployCommand()}`);
	console.log(hungRun.output.trim().split('\n').map((line) => `    | ${line}`).join('\n'));
	check('the script reports the failure', hungRun.status !== 0, hungRun.output);
	check('the old version is running again', runningVersion() === nextVersion, runningVersion());
	familyIsIntact('after a hung update');

	console.log('\n--- Rollback ---');
	const rollback = deploy('rollback');
	check('rollback succeeds', rollback.status === 0, rollback.output);
	check('the previous version is running', runningVersion() === version, runningVersion());
	familyIsIntact('after a rollback');
	check('a second rollback is refused, because there is nothing earlier', deploy('rollback').status !== 0);

	console.log('\n--- Backup, wipe, and restore ---');
	const backup = deploy('backup');
	check('a backup succeeds', backup.status === 0, backup.output);
	const saved = backup.output.match(/Saved (backups\/\S+)/)?.[1];
	check('it says where the copy went', !!saved, backup.output);
	check('the app is back up after the backup', runningVersion() === version);

	const notConfirmed = deploy('wipe', 'nope\n');
	check('a wipe needs the word typed exactly', notConfirmed.status !== 0 && notConfirmed.output.includes('Nothing was changed'), notConfirmed.output);
	check('the data is still there', browserTests('restart'));

	const wipe = deploy('wipe', 'DELETE\nn\n');
	check('a wipe succeeds', wipe.status === 0, wipe.output);
	check('it gives a new first-run link', !!setupLink(wipe.output), wipe.output);

	check('a restore needs the word typed exactly', deploy(`restore ${saved}`, 'nope\n').status !== 0);
	const restore = deploy(`restore ${saved}`, 'RESTORE\n');
	check('a restore succeeds', restore.status === 0, restore.output);
	familyIsIntact('after being wiped and restored');

	if (sourceBuild) {
		console.log('\n--- Building from source, as on a server with another type of CPU ---');
		await copyInZip(version, `secret-santa:${version}`);
		onServer('rm -f image-amd64.tar.gz');
		const built = deploy();
		check('the build and update succeed', built.status === 0, built.output);
		check('it says it built one', built.output.includes('being built here'), built.output);
		check('the built version is running', runningVersion() === version, runningVersion());
		familyIsIntact('after building from source');
	}

	console.log('\n--- The made-up family, then starting for real ---');
	const demo = deploy('wipe', 'DELETE\ny\n');
	check('a wipe can start the made-up family', demo.status === 0 && demo.output.includes('made-up family'), demo.output);
	check('the login page lists the sign-ins', (await (await fetch(`${BASE_URL}/login`)).text()).includes('jinglebells'));
	const real = deploy('wipe', 'DELETE\nn\n');
	check('a wipe can leave it behind', real.status === 0 && !!setupLink(real.output), real.output);
	check('demo mode is off in .env', onServer('grep -c "^DEMO_MODE=true" .env').stdout.trim() === '0');
	check('the login page no longer lists sign-ins', !(await (await fetch(`${BASE_URL}/login`)).text()).includes('jinglebells'));
}

let failed = false;
try {
	await main();
} catch (err) {
	failed = true;
	console.error(`\n${err instanceof Error ? err.message : err}`);
	const logs = docker(['exec', SERVER, 'docker', 'logs', '--tail', '30', 'secret-santa']);
	console.error(`--- App log on the fake server ---\n${logs.stdout}${logs.stderr}`);
}
stopServer();
for (const tag of testImages) docker(['rmi', tag]);
rmSync(work, { recursive: true, force: true });
console.log(`\n${results.filter((result) => result.ok).length} of ${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
