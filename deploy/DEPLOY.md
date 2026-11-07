# Running Secret Santa on your server

You need a Linux server with Docker and Docker Compose version 2. Everything else is in this folder.

## First install

From this folder, run:

```sh
sh deploy.sh
```

It asks for your address and Anthropic key, starts the app, and prints the first-run link. Open that link to create your account. It only works until your account exists.

To test with a made-up family of 6 adults and 4 kids, answer yes when it asks. The login page then lists the sign-ins. If you're testing before your reverse proxy is ready, use `http://THIS-SERVERS-IP:3000` as the address.

## When you've finished testing

```sh
sh deploy.sh wipe
```

This deletes the test data and gives you a new first-run link. Choose no when it offers the made-up family. If you tested on a temporary address, set `ORIGIN` in `.env` to the real one before you wipe.

## Installing an update

Copy the new zip next to this folder, then run this from the folder that holds them both:

```sh
unzip -o secret-santa-1.2.3.zip
sh secret-santa/deploy.sh
```

Use the new zip's name. It unpacks over this folder and leaves your settings and backups alone. Your data isn't in this folder, so it stays where it is.

The script saves a copy of the data, starts the new version, and checks that it's answering. If it isn't, the script puts the old version and the saved data back on its own, so a bad update doesn't take the site down.

If you find a problem later, go back to the previous version with `sh deploy.sh rollback`. That keeps everything the family has done since the update.

## Other commands

| Command | What it does |
|---|---|
| `sh deploy.sh status` | Shows the running version and its health, and the first-run link if it's still needed. |
| `sh deploy.sh logs` | Follows the app's logs. Press Ctrl+C to stop watching. |
| `sh deploy.sh backup` | Saves a copy of all the data in the `backups` folder. The app stops for a few seconds. |
| `sh deploy.sh restore FILE` | Replaces all the data with a saved copy. Your current data is saved first. |

The last 10 saved copies are kept. The app also keeps 14 days of database snapshots, which you can download from its Settings page.

## Keep the backups safe

Each file in `backups` includes the key that unlocks the sealed names, so opening one could spoil the draw. To protect against losing the server, copy the newest one somewhere else. Keep `.env` too, because it holds your settings.

To move to a new server, install there with `sh deploy.sh`, then run `sh deploy.sh restore` with your saved copy.

## Reverse proxy

Point your proxy at the port you chose and forward the usual headers. `ORIGIN` in `.env` must exactly match the address in the browser, or forms will be rejected.

If the proxy runs on this same machine, add `HOST_BIND=127.0.0.1` to `.env` so the app can only be reached through it. Otherwise, anyone on your network could reach the app directly and forge the forwarded address to get around login throttling. If the proxy runs in another container on this machine, leave `HOST_BIND` unset, because a container can't reach the host's `127.0.0.1`.

Santa's replies stream as they're written. The app sends `X-Accel-Buffering: no`, which nginx honors. On other proxies, turn off response buffering for `/api/santa/chat`.

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 8m;
}
```

Run `sh deploy.sh` again after changing `.env`.

## If something goes wrong

| What you see | What to do |
|---|---|
| A message about a port already being used | Choose another `HOST_PORT` in `.env`, then run `sh deploy.sh` again. |
| "Can't reach Docker" | If Docker is running, your account may not have access to it. Try `sudo sh deploy.sh`. |
| Forms say they're forbidden, or login does nothing | `ORIGIN` in `.env` doesn't match the address in your browser. Fix it, then run `sh deploy.sh`. |
| `unzip` isn't installed | Install it (`sudo apt install unzip`), or unpack with `python3 -m zipfile -e secret-santa-1.2.3.zip .` and then run `sh deploy.sh` from inside the `secret-santa` folder. |
