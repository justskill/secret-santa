<img src="static/favicon.svg" width="64" height="64" alt="">

# Secret Santa

A private family Secret Santa portal with an AI Santa. It handles the draw, wish lists, anonymous questions, off-list permission slips, countdowns, and reminders, all from one Docker container on your own server.

## Try it first with a made-up family

This runs the app with 6 adults and 4 kids, and doesn't touch any real data. The login page lists the sign-ins.

```sh
docker build -t secret-santa .
docker run --rm -p 3000:3000 \
  -e ORIGIN=http://localhost:3000 \
  -e DEMO_MODE=true \
  -e ANTHROPIC_API_KEY=your-key-here \
  -v santa-demo:/data \
  secret-santa
```

Then open http://localhost:3000. Demo mode uses a $5 AI budget and a very short anonymous mail delay, so you can test quickly. Leave out the API key to see how the app behaves without Santa.

To start the demo over, delete its data with `docker volume rm santa-demo`.

## Deploy for real

You need a Linux server with Docker and Docker Compose version 2.

1. Copy the zip from `dist/` to your server. To build one, see [Making changes later](#making-changes-later).
2. Unpack it and run the installer:

   ```sh
   unzip secret-santa-1.0.0.zip
   sh secret-santa/deploy.sh
   ```

3. Answer its questions. When it finishes, it prints the first-run link. Only someone who can read the server's logs can claim a new install.
4. Open the link, then follow the checklist on the Head Elf's Office page.

[DEPLOY.md](deploy/DEPLOY.md), which is also in the zip, covers updates, rollbacks, backups, clearing test data, and setting up your reverse proxy.

## Making changes later

1. Make the change, then run `npm run release`. It moves to the next version number, runs the free tests, and builds `dist/secret-santa-<version>.zip`. If a test fails, it makes no zip and keeps the current version number.
2. Run `npm run test:deploy` to try that zip on a clean Docker. It installs and updates the app, and checks that a failed update recovers.
3. Copy the zip to the folder on your server that holds the `secret-santa` folder, then run:

   ```sh
   unzip -o secret-santa-<version>.zip
   sh secret-santa/deploy.sh
   ```

The script saves a copy of the data, starts the new version, and checks that it's answering. If it isn't, the script puts the old version and the saved data back on its own. Database changes go in `MIGRATIONS` in `src/lib/server/db.ts` and run by themselves when the new version starts. Keep them additive, so `sh deploy.sh rollback` still works.

## Settings

| Variable | Purpose |
|---|---|
| `ORIGIN` | Required. The public address of the site. |
| `ANTHROPIC_API_KEY` | Turns Santa on. Without it, everything else still works. |
| `DEMO_MODE` | `true` fills an empty database with the demo family. |
| `SANTA_SECRET` | Optional. Use this passphrase as the encryption key, instead of the generated `secret.key`. |
| `HOST_PORT` | Compose only. The port on your server. Defaults to 3000. |
| `HOST_BIND` | Compose only. The network address to listen on. Defaults to all of them. |

Everything else (the AI model, budget, ntfy, time zone, and delays) is set on the Settings page in the app.

## Your data

Everything lives in the `secret-santa-data` Docker volume, which updates don't touch:

- `santa.db` is the database.
- `secret.key` is the key that seals the pairings and chats. **A database backup is useless without it**, so keep a copy of it somewhere safe.
- `media/` holds family photos.
- `backups/` holds daily database snapshots, and the last 14 are kept. You can also download them from Settings.

`sh deploy.sh backup` saves the database, key, and photos together in one file on the server.

Names, wish lists, and chats with Santa are sent to Anthropic's API to generate his replies. The app doesn't collect addresses, birthdays, or payment details.

For a look back after the season, the app also keeps counts:
- **Santa's calls:** why each one stopped (a refusal, a cut-off, or running out of steps).
- **Chats:** how many were turned away and why (Santa switched off, the budget, no key, the daily limit, or Santa still answering), and how many failed.
- **Text:** how many chat messages and pasted lists were too long and got cut.
- **Sign-ins:** successful and failed sign-ins, and lockouts.
- **Activity:** which weeks each person used the app.

These counts hold only reason codes and numbers. They never hold anything someone typed, the name typed at sign-in, or an IP address. Failed sign-ins and lockouts stop being counted after 200 a day, so a bot can't fill the database. The admin dashboard shows only totals.

## How the secrets are kept

- **Santa can't leak what he can't see.** Each of his tools acts only on the signed-in profile, and no tool can look up who drew someone. So no clever prompt can get the answer out of him.
- **Anything Santa wants to change needs a tap.** His tools only prepare a card. A person's tap runs it, and permissions are checked again at that moment.
- **Anonymous messages carry no sender.** The person answering receives only the text and a random thread id. Santa rewords each message to hide the writing style, the sender approves the wording, and it arrives after a random delay. Store links have their tracking removed, because share links can identify the buyer.
- **The admin is blind too.** Admin screens show progress, never pairs. Pairings, chats, notices, and proposed actions are encrypted at rest. Product images are copied to your server, so opening a list never contacts an outside server.
- **Mail pings name only a family.** When a question or permission slip reaches someone, the organizer's phone gets a ping naming only that person's family, so the organizer can nudge someone there. It goes out on delivery, so it has the same random delay as the message, and it reads the same whoever asked. Answers going back to a Santa never ping. Otherwise, the organizer could answer an anonymous question and learn from the next ping which family their own Santa is in.
- **Peeking leaves a trace.** The emergency reveal tells the whole family immediately, with the reason you gave, and that notice can't be deleted. Changing who can open a kid's profile during a sealed draw, or using a reset link on someone's account, also alerts the family.
- **The seal can be checked.** A fingerprint of the draw is published when the names are sealed. After the big reveal, anyone can recheck it in their browser.

The limit: whoever runs the server owns the machine and the key. This design prevents accidental spoilers and makes in-app peeking visible, but software alone can't stop a server owner who deliberately goes looking in the database, and the seal can't prove the first draw was fair. The fairness page shows every rule and how many arrangements Santa chose from, which makes a stacked draw easy to spot.

The server also fetches links that family members paste, so it refuses private network addresses, including through redirects. A pasted link can't be used to read your router or NAS.

## Development

```sh
npm install
npm run dev        # Reads ANTHROPIC_API_KEY from .env
npm test           # Unit tests, including the secrecy rules. Free, and needs no key.
npm run check      # Type checks
npm run build && npm run test:e2e    # Browser tests against the production build. Free.
npm run build && npm run test:live   # Real Santa tests against the Anthropic API. Costs under $1.
npm run test:docker                  # Builds the image and tests first-run setup and restarts.
npm run release                      # Runs the free tests and builds the zip for your server.
npm run test:deploy                  # Tries the newest zip on a clean Docker. Add -- --source-build to also build from source.
```

The stack is SvelteKit, TypeScript, SQLite (`better-sqlite3`), and the Anthropic SDK. Secrecy-sensitive code lives in `src/lib/server/draw/`, `src/lib/server/threads.ts`, and `src/lib/server/santa/tools.ts`.

SvelteKit stays on the 2.x line for now, because 3.x needs Node 22.17 or later.
