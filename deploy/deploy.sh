#!/bin/sh
#
# Installs or updates Secret Santa on this server. Run it from the folder you unzipped.
#
#   sh deploy.sh              Install, or update to the version in this folder
#   sh deploy.sh status       Show what's running, and the first-run link if it's still needed
#   sh deploy.sh logs         Follow the app's logs
#   sh deploy.sh backup       Save a copy of all the data in the backups folder
#   sh deploy.sh restore F    Replace all the data with a copy from the backups folder
#   sh deploy.sh rollback     Go back to the previous version, keeping today's data
#   sh deploy.sh wipe         Delete all the data and start fresh, such as after testing
#
# The family's data lives in the Docker volume named below, not in this folder. Anything here that
# could change it saves a copy first.

set -u
# Backups and .env hold secrets, so nothing this script creates is readable by other users.
umask 077
cd "$(dirname "$0")" || exit 1

NAME=secret-santa
VOLUME=secret-santa-data
CURRENT=$NAME:current
PREVIOUS=$NAME:previous
BEFORE=$NAME:before-update
BACKUPS=backups
BACKUPS_KEPT=10
HEALTH_WAIT_SECONDS=${SANTA_HEALTH_WAIT_SECONDS:-120}

SNAPSHOT=
COMPOSE=
ANSWER=

say() { printf '%s\n' "$*"; }

die() {
	printf '\n%s\n' "$*" >&2
	exit 1
}

ask() {
	printf '%s' "$1"
	IFS= read -r ANSWER || ANSWER=
}

ask_hidden() {
	printf '%s' "$1"
	if [ -t 0 ]; then
		trap 'stty echo; exit 130' INT TERM
		stty -echo
		IFS= read -r ANSWER || ANSWER=
		stty echo
		trap - INT TERM
		printf '\n'
	else
		IFS= read -r ANSWER || ANSWER=
	fi
}

confirm() {
	say "$1"
	ask "Type $2 to continue: "
	[ "$ANSWER" = "$2" ] || die "Nothing was changed."
}

require_docker() {
	command -v docker >/dev/null 2>&1 || die "Docker isn't installed on this machine."
	docker info >/dev/null 2>&1 || die "Can't reach Docker. Check that it's running. If it is, try: sudo sh deploy.sh"
	if docker compose version >/dev/null 2>&1; then
		COMPOSE='docker compose'
	elif [ "$(docker-compose version --short 2>/dev/null | cut -d. -f1)" -ge 2 ] 2>/dev/null; then
		COMPOSE=docker-compose
	else
		die "This needs Docker Compose version 2 or newer: https://docs.docker.com/compose/install/"
	fi
}

compose() {
	# shellcheck disable=SC2086 # COMPOSE can be two words.
	$COMPOSE "$@"
}

image_id() { docker image inspect --format '{{.Id}}' "$1" 2>/dev/null; }
has_image() { [ -n "$(image_id "$1")" ]; }
has_data() { docker volume inspect "$VOLUME" >/dev/null 2>&1; }
image_version() { docker run --rm --entrypoint node "$1" -p "require('/app/package.json').version" 2>/dev/null || say unknown; }
running_version() { docker exec "$NAME" node -p "require('/app/package.json').version" 2>/dev/null || say unknown; }

# ---- Settings ----

write_env_if_missing() {
	[ -f .env ] && return 0
	[ -f .env.example ] || die "This folder is missing .env.example. Try unzipping again."

	say "First-time setup. Your answers are saved in a file named .env, and updates won't touch it."
	say ""
	say "What address will your family use? Something like https://santa.example.com"
	say "To try it on your own network first, use http://THIS-SERVERS-IP:3000"
	ask "Address: "
	origin=$(printf '%s' "$ANSWER" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's:/*$::')
	case "$origin" in
		*[[:space:]]*) die "That address has a space in it. Nothing was changed." ;;
		http://?* | https://?*) ;;
		*) die "The address needs to start with http:// or https://. Nothing was changed." ;;
	esac

	say ""
	say "Your Anthropic API key turns on Santa chat. Everything else works without it, and you can"
	say "add it to .env later. Press Enter to skip."
	ask_hidden "API key: "
	api_key=$ANSWER

	say ""
	ask "Which port should the app listen on? [3000] "
	port=${ANSWER:-3000}
	case "$port" in
		'' | *[!0-9]*) die "The port needs to be a number. Nothing was changed." ;;
	esac

	say ""
	say "You can fill it with a made-up family for testing, and clear it later with: sh deploy.sh wipe"
	ask "Use the made-up family? [y/N] "
	case "$ANSWER" in
		y | Y | yes | Yes | YES) demo=true ;;
		*) demo=false ;;
	esac

	ENV_ORIGIN=$origin ENV_KEY=$api_key ENV_PORT=$port ENV_DEMO=$demo awk '
		/^ORIGIN=/ { print "ORIGIN=" ENVIRON["ENV_ORIGIN"]; next }
		/^ANTHROPIC_API_KEY=/ { print "ANTHROPIC_API_KEY=" ENVIRON["ENV_KEY"]; next }
		/^HOST_PORT=/ { print "HOST_PORT=" ENVIRON["ENV_PORT"]; next }
		/^# DEMO_MODE=/ && ENVIRON["ENV_DEMO"] == "true" { print "DEMO_MODE=true"; next }
		{ print }
	' .env.example >.env || {
		rm -f .env
		die "Couldn't write the .env file."
	}
	say ""
}

set_demo_mode() {
	awk -v demo="$1" '
		/^#? *DEMO_MODE=/ {
			if (!done) print (demo == "true" ? "DEMO_MODE=true" : "# DEMO_MODE=true")
			done = 1
			next
		}
		{ print }
		END { if (!done && demo == "true") print "DEMO_MODE=true" }
	' .env >.env.new && cat .env.new >.env
	rm -f .env.new
}

# ---- Saving and restoring the data ----

# Saves the data volume to a new file, in SNAPSHOT. The app has to be stopped first. The file goes
# through a pipe, so this works however Docker's file sharing is set up on the server.
save_snapshot() {
	mkdir -p "$BACKUPS" || return 1
	SNAPSHOT=$BACKUPS/santa-$(date +%Y%m%d-%H%M%S)-$1.tar.gz
	if ! docker run --rm -v "$VOLUME:/data:ro" --entrypoint tar "$2" czf - -C /data --exclude=./backups . >"$SNAPSHOT"; then
		rm -f "$SNAPSHOT"
		return 1
	fi
}

# Removing old copies is separate from saving, so a restore can't delete the file it's restoring.
prune_snapshots() {
	# shellcheck disable=SC2012 # These names are ours and have no spaces.
	ls -t "$BACKUPS"/santa-*.tar.gz 2>/dev/null | tail -n +"$((BACKUPS_KEPT + 1))" | while IFS= read -r old; do
		rm -f "$old"
	done
}

restore_snapshot() {
	docker run --rm -i -v "$VOLUME:/data" --entrypoint sh "$2" -c \
		'find /data -mindepth 1 -maxdepth 1 ! -name backups -exec rm -rf {} + && tar xzf - -C /data --no-same-owner' <"$1"
}

# ---- Starting and checking the app ----

app_answers() {
	docker exec "$NAME" node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1
}

wait_until_healthy() {
	waited=0
	while [ "$waited" -lt "$HEALTH_WAIT_SECONDS" ]; do
		# Docker keeps restarting an app that crashes on startup, so there's no point waiting it out.
		restarts=$(docker inspect --format '{{.RestartCount}}' "$NAME" 2>/dev/null)
		[ "${restarts:-0}" -ge 2 ] && return 1
		if app_answers; then
			# Checking twice means an app that starts and immediately falls over doesn't pass.
			sleep 3
			app_answers && return 0
		fi
		sleep 2
		waited=$((waited + 3))
	done
	return 1
}

setup_is_open() {
	docker exec "$NAME" node -e "fetch('http://127.0.0.1:3000/setup',{redirect:'manual'}).then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1
}

show_running() {
	origin=$(sed -n 's/^ORIGIN=//p' .env | tail -n 1)
	say ""
	say "Secret Santa $(running_version) is running at $origin"
	if setup_is_open; then
		say ""
		say "To finish setting up, open this link. It stops working once your account exists:"
		say "  $(docker logs "$NAME" 2>&1 | sed -n 's/.*First-run setup link: //p' | tail -n 1 | tr -d '\r')"
	elif grep -q '^DEMO_MODE=true' .env; then
		say ""
		say "This is the made-up family. The login page lists the sign-ins."
		say "When you've finished testing, clear it with: sh deploy.sh wipe"
	fi
}

show_failure_log() {
	say ""
	say "Here's the end of its log:"
	docker logs --tail 30 "$NAME" 2>&1 | sed 's/^/  /'
}

# Keeps the running version and the one before it, and removes the rest.
prune_images() {
	keep_current=$(image_id "$CURRENT")
	keep_previous=$(image_id "$PREVIOUS")
	docker images "$NAME" --format '{{.Repository}}:{{.Tag}}' | while IFS= read -r ref; do
		id=$(image_id "$ref")
		if [ "$id" != "$keep_current" ] && [ "$id" != "$keep_previous" ]; then
			docker rmi "$ref" >/dev/null 2>&1
		fi
	done
}

# ---- Install or update ----

load_image() {
	case "$(docker info --format '{{.Architecture}}' 2>/dev/null)" in
		x86_64 | amd64) arch=amd64 ;;
		aarch64 | arm64) arch=arm64 ;;
		*) arch=other ;;
	esac
	if [ -f "image-$arch.tar.gz" ]; then
		say "Loading version $VERSION. This takes a minute..."
		docker load -i "image-$arch.tar.gz" >/dev/null || die "Couldn't load the image. The zip may have been damaged in the copy, so try copying it again."
	elif [ -f source.tar.gz ]; then
		say "This zip has no ready-made image for this server's type of CPU, so one is being built here."
		say "That can take ten minutes or more, and needs internet access..."
		build_dir=$(mktemp -d) || die "Couldn't create a temporary folder."
		# The image runs as an ordinary user, who has to be able to read what gets built.
		if ! tar xzf source.tar.gz -C "$build_dir" || ! chmod -R a+rX "$build_dir"; then
			rm -rf "$build_dir"
			die "Couldn't unpack the source code. Try unzipping again."
		fi
		if ! docker build -t "$NEW" "$build_dir"; then
			rm -rf "$build_dir"
			die "The build failed, so nothing was changed. The messages above say why."
		fi
		rm -rf "$build_dir"
	else
		die "This folder has nothing to install. Try unzipping again."
	fi
	has_image "$NEW" || die "The image in this folder doesn't match version $VERSION. Try unzipping again."
}

# The new version never served anyone, so putting the saved data back loses nothing.
recover_from_failed_start() {
	show_failure_log
	compose stop >/dev/null 2>&1
	if [ -n "$SNAPSHOT" ]; then
		restore_snapshot "$SNAPSHOT" "$NEW" || die "Couldn't put the saved data back. It's safe in $SNAPSHOT. To restore it: sh deploy.sh restore $SNAPSHOT"
	fi
	if ! has_image "$BEFORE"; then
		die "Version $VERSION didn't start. If the log mentions a port already in use, change HOST_PORT in .env, then run this again."
	fi
	docker tag "$BEFORE" "$CURRENT"
	docker rmi "$BEFORE" "$NEW" >/dev/null 2>&1
	compose up -d >/dev/null 2>&1
	if wait_until_healthy; then
		die "Version $VERSION didn't start, so the server went back to version $(running_version) with its data as it was. Nothing was lost."
	fi
	die "Version $VERSION didn't start, and neither did the version before it. The data was saved in $SNAPSHOT."
}

cmd_deploy() {
	require_docker
	[ -f VERSION ] || die "This folder is missing its VERSION file. Try unzipping again."
	VERSION=$(cat VERSION)
	NEW=$NAME:$VERSION
	write_env_if_missing
	load_image

	# Running this again changes nothing, apart from picking up any edits to .env.
	if [ "$(image_id "$NEW")" = "$(image_id "$CURRENT")" ]; then
		say "Version $VERSION is already installed, so this just checks that it's running."
		compose up -d || die "Couldn't start the app. The messages above say why."
		if ! wait_until_healthy; then
			show_failure_log
			die "The app isn't answering."
		fi
		show_running
		return
	fi

	if has_data; then
		say "Saving a copy of the data first..."
		compose stop >/dev/null 2>&1
		if ! save_snapshot "before-$VERSION" "$NEW"; then
			compose up -d >/dev/null 2>&1
			die "Couldn't save a copy of the data, so nothing was changed. Check the free disk space."
		fi
	fi

	has_image "$CURRENT" && docker tag "$CURRENT" "$BEFORE"
	docker tag "$NEW" "$CURRENT"
	say "Starting version $VERSION..."
	if compose up -d && wait_until_healthy; then
		if has_image "$BEFORE"; then
			docker tag "$BEFORE" "$PREVIOUS"
			docker rmi "$BEFORE" >/dev/null 2>&1
		fi
		prune_images
		prune_snapshots
		show_running
		if [ -n "$SNAPSHOT" ]; then
			say ""
			say "The data from just before this update is saved in $SNAPSHOT"
		fi
		return 0
	fi
	recover_from_failed_start
}

# ---- The other commands ----

cmd_status() {
	require_docker
	if [ "$(docker inspect --format '{{.State.Running}}' "$NAME" 2>/dev/null)" != true ]; then
		say "Secret Santa isn't running. To start it: sh deploy.sh"
		return
	fi
	show_running
	say ""
	say "Health: $(docker inspect --format '{{.State.Health.Status}}' "$NAME" 2>/dev/null)"
	if has_image "$PREVIOUS"; then
		say "Previous version, for sh deploy.sh rollback: $(image_version "$PREVIOUS")"
	fi
	# shellcheck disable=SC2012 # These names are ours and have no spaces.
	newest=$(ls -t "$BACKUPS"/santa-*.tar.gz 2>/dev/null | head -n 1)
	if [ -n "$newest" ]; then
		say "Newest saved copy of the data: $newest"
	fi
}

cmd_backup() {
	require_docker
	has_data || die "There's no data to save yet."
	has_image "$CURRENT" || die "Secret Santa isn't installed here yet. Run: sh deploy.sh"
	say "Stopping the app for a few seconds, so the copy is complete..."
	compose stop >/dev/null 2>&1
	save_snapshot manual "$CURRENT"
	saved=$?
	compose up -d >/dev/null 2>&1
	[ "$saved" -eq 0 ] || die "Couldn't save a copy of the data. Check the free disk space."
	wait_until_healthy || die "The copy was saved in $SNAPSHOT, but the app isn't answering. To see why: sh deploy.sh logs"
	prune_snapshots
	say "Saved $SNAPSHOT"
	say "It includes the key that unlocks the sealed names, so keep it safe and don't open it."
}

cmd_restore() {
	require_docker
	file=${1:-}
	if [ -z "$file" ]; then
		say "Which copy? For example: sh deploy.sh restore backups/santa-20261224-090000-manual.tar.gz"
		say ""
		# shellcheck disable=SC2012 # These names are ours and have no spaces.
		ls -t "$BACKUPS"/santa-*.tar.gz 2>/dev/null || say "There are no saved copies in the backups folder."
		exit 1
	fi
	[ -f "$file" ] || die "Can't find $file"
	tar tzf "$file" >/dev/null 2>&1 || die "$file isn't a readable backup."
	has_image "$CURRENT" || die "Install Secret Santa first with: sh deploy.sh"

	confirm "This replaces all of the app's data with the copy in $file." RESTORE
	compose stop >/dev/null 2>&1
	if has_data; then
		save_snapshot before-restore "$CURRENT" || {
			compose up -d >/dev/null 2>&1
			die "Couldn't save a copy of the current data, so nothing was changed."
		}
		say "The data from before this restore is saved in $SNAPSHOT"
	fi
	restore_snapshot "$file" "$CURRENT" || die "Couldn't put that copy in place. The current data is in $SNAPSHOT"
	compose up -d || die "Couldn't start the app. The messages above say why."
	if ! wait_until_healthy; then
		show_failure_log
		die "The app isn't answering after the restore. To put the data back: sh deploy.sh restore $SNAPSHOT"
	fi
	prune_snapshots
	show_running
}

cmd_rollback() {
	require_docker
	has_image "$PREVIOUS" || die "There's no earlier version on this server to go back to."
	from=$(running_version)
	to=$(image_version "$PREVIOUS")
	say "Going back from version $from to version $to. The family's data stays as it is now."
	docker tag "$CURRENT" "$BEFORE"
	docker tag "$PREVIOUS" "$CURRENT"
	if compose up -d && wait_until_healthy; then
		docker rmi "$PREVIOUS" "$BEFORE" >/dev/null 2>&1
		prune_images
		show_running
		say ""
		say "To update again, unzip the version you want here and run: sh deploy.sh"
		return
	fi
	show_failure_log
	docker tag "$BEFORE" "$CURRENT"
	docker rmi "$BEFORE" >/dev/null 2>&1
	compose up -d >/dev/null 2>&1
	wait_until_healthy || die "Version $to didn't start, and neither did version $from."
	die "Version $to didn't start, so the server stayed on version $from."
}

cmd_wipe() {
	require_docker
	has_image "$CURRENT" || die "Secret Santa isn't installed here yet. Run: sh deploy.sh"
	confirm "This deletes everyone, the draw, every wish list, and all chats and photos, then starts fresh." DELETE
	if has_data; then
		compose stop >/dev/null 2>&1
		save_snapshot before-wipe "$CURRENT" || {
			compose up -d >/dev/null 2>&1
			die "Couldn't save a copy of the data first, so nothing was changed."
		}
		compose down >/dev/null 2>&1
		docker volume rm "$VOLUME" >/dev/null || die "Couldn't delete the data volume. The messages above say why."
		say "Deleted. In case you need it, a copy is in $SNAPSHOT"
	fi
	say ""
	ask "Start with the made-up family for testing? Choose no for the real thing. [y/N] "
	case "$ANSWER" in
		y | Y | yes | Yes | YES) set_demo_mode true ;;
		*) set_demo_mode false ;;
	esac
	compose up -d || die "Couldn't start the app. The messages above say why."
	if ! wait_until_healthy; then
		show_failure_log
		die "The app isn't answering."
	fi
	prune_snapshots
	show_running
}

usage() {
	sed -n '3,11p' "$0" | sed 's/^# \{0,1\}//'
}

case "${1:-deploy}" in
	deploy | install | update) cmd_deploy ;;
	status) cmd_status ;;
	logs)
		require_docker
		docker logs -f --tail 100 "$NAME"
		;;
	backup) cmd_backup ;;
	restore)
		shift
		cmd_restore "$@"
		;;
	rollback) cmd_rollback ;;
	wipe) cmd_wipe ;;
	help | -h | --help) usage ;;
	*)
		usage
		exit 1
		;;
esac
