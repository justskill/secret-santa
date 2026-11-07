import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { dataDir } from './env';

type DB = Database.Database;

/**
 * Ordered schema changes. Each entry runs once and bumps PRAGMA user_version.
 * Only append; never edit an entry that has shipped.
 *
 * Keep changes additive: new tables, or new columns with defaults. Rolling back an update keeps the
 * family's data, so the previous version of the app has to keep working on a newer database.
 */
const MIGRATIONS: string[] = [
	`
	CREATE TABLE settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);

	CREATE TABLE households (
		id INTEGER PRIMARY KEY,
		name TEXT NOT NULL UNIQUE
	);

	CREATE TABLE people (
		id INTEGER PRIMARY KEY,
		display_name TEXT NOT NULL,
		kind TEXT NOT NULL CHECK (kind IN ('adult', 'kid')),
		household_id INTEGER REFERENCES households(id) ON DELETE SET NULL,
		username TEXT UNIQUE COLLATE NOCASE,
		password_hash TEXT,
		is_admin INTEGER NOT NULL DEFAULT 0,
		phone TEXT,
		photo TEXT,
		color TEXT NOT NULL DEFAULT 'cranberry',
		active INTEGER NOT NULL DEFAULT 1,
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
	);

	CREATE TABLE guardianships (
		guardian_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
		ward_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
		PRIMARY KEY (guardian_id, ward_id)
	);

	-- Who answers "is this OK to buy?" about a person. Kids fall back to their guardians.
	CREATE TABLE approvers (
		person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
		approver_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
		PRIMARY KEY (person_id, approver_id)
	);

	CREATE TABLE invites (
		token_hash TEXT PRIMARY KEY,
		person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
		expires_at TEXT NOT NULL,
		used_at TEXT,
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
	);

	CREATE TABLE sessions (
		token_hash TEXT PRIMARY KEY,
		person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
		acting_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
		expires_at TEXT NOT NULL,
		last_seen_at TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
	);

	CREATE TABLE seasons (
		id INTEGER PRIMARY KEY,
		name TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'sealed', 'revealed', 'archived')),
		spend_limit TEXT NOT NULL DEFAULT '',
		house_rules TEXT NOT NULL DEFAULT '',
		draw_opens_at TEXT,
		rule_guardian INTEGER NOT NULL DEFAULT 1,
		rule_household INTEGER NOT NULL DEFAULT 1,
		rule_no_reciprocal INTEGER NOT NULL DEFAULT 0,
		rule_no_repeat INTEGER NOT NULL DEFAULT 1,
		sealed_at TEXT,
		revealed_at TEXT,
		emergency_reveals INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
	);

	CREATE TABLE season_participants (
		season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
		person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
		PRIMARY KEY (season_id, person_id)
	);

	CREATE TABLE pair_rules (
		id INTEGER PRIMARY KEY,
		season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
		giver_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
		receiver_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
		both_ways INTEGER NOT NULL DEFAULT 1,
		note TEXT NOT NULL DEFAULT ''
	);

	-- The receiver is sealed. Nothing readable in this table links a giver to a receiver.
	CREATE TABLE assignments (
		season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
		giver_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
		receiver_sealed TEXT NOT NULL,
		revealed_at TEXT,
		changed_at TEXT,
		PRIMARY KEY (season_id, giver_id)
	);

	CREATE TABLE draw_commitments (
		id INTEGER PRIMARY KEY,
		season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
		version INTEGER NOT NULL,
		hash TEXT NOT NULL,
		payload_sealed TEXT NOT NULL,
		reason TEXT NOT NULL,
		arrangements INTEGER,
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
		UNIQUE (season_id, version)
	);

	CREATE TABLE list_meta (
		season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
		person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
		amazon_url TEXT,
		intro_note TEXT NOT NULL DEFAULT '',
		ready_at TEXT,
		update_notified_at TEXT,
		PRIMARY KEY (season_id, person_id)
	);

	CREATE TABLE wish_items (
		id INTEGER PRIMARY KEY,
		season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
		person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
		title TEXT NOT NULL,
		url TEXT,
		image_url TEXT,
		price_text TEXT,
		notes TEXT NOT NULL DEFAULT '',
		priority INTEGER NOT NULL DEFAULT 2,
		source TEXT NOT NULL DEFAULT 'manual',
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
		updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
		deleted_at TEXT
	);
	CREATE INDEX wish_items_owner ON wish_items (season_id, person_id) WHERE deleted_at IS NULL;

	-- Standing advice for whoever is shopping for this person.
	CREATE TABLE guidance (
		person_id INTEGER PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
		notes TEXT NOT NULL DEFAULT '',
		helper_notes TEXT NOT NULL DEFAULT '',
		updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
	);

	-- giver_tag is a keyed hash, so this table does not reveal who is buying.
	CREATE TABLE gifts (
		id TEXT PRIMARY KEY,
		season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
		giver_tag TEXT NOT NULL,
		subject_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
		wish_item_id INTEGER REFERENCES wish_items(id) ON DELETE SET NULL,
		title TEXT NOT NULL,
		url TEXT,
		price_text TEXT,
		off_list INTEGER NOT NULL DEFAULT 0,
		bought INTEGER NOT NULL DEFAULT 0,
		approval TEXT NOT NULL DEFAULT 'not_needed' CHECK (approval IN ('not_needed', 'none', 'waiting', 'approved', 'declined')),
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
		updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
	);
	CREATE INDEX gifts_giver ON gifts (season_id, giver_tag);
	CREATE INDEX gifts_item ON gifts (wish_item_id);

	-- An anonymous conversation. The buyer is only ever stored sealed.
	CREATE TABLE threads (
		id TEXT PRIMARY KEY,
		season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
		kind TEXT NOT NULL CHECK (kind IN ('question', 'approval')),
		route TEXT NOT NULL CHECK (route IN ('person', 'helpers')),
		subject_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
		buyer_tag TEXT NOT NULL,
		buyer_sealed TEXT NOT NULL,
		gift_id TEXT REFERENCES gifts(id) ON DELETE SET NULL,
		status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'approved', 'declined', 'closed')),
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
		updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
	);
	CREATE INDEX threads_buyer ON threads (season_id, buyer_tag);
	CREATE INDEX threads_subject ON threads (season_id, subject_id);

	CREATE TABLE thread_messages (
		id TEXT PRIMARY KEY,
		thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
		direction TEXT NOT NULL CHECK (direction IN ('to_answerer', 'to_buyer')),
		body TEXT NOT NULL,
		decision TEXT,
		deliver_at TEXT NOT NULL,
		delivered_at TEXT,
		read_at TEXT,
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
	);
	CREATE INDEX thread_messages_due ON thread_messages (delivered_at, deliver_at);

	CREATE TABLE notices (
		id INTEGER PRIMARY KEY,
		season_id INTEGER REFERENCES seasons(id) ON DELETE CASCADE,
		person_id INTEGER REFERENCES people(id) ON DELETE CASCADE,
		kind TEXT NOT NULL DEFAULT 'info',
		title TEXT NOT NULL,
		body TEXT NOT NULL DEFAULT '',
		link TEXT,
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
	);
	CREATE INDEX notices_person ON notices (person_id, created_at);

	CREATE TABLE notice_reads (
		notice_id INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
		person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
		read_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
		PRIMARY KEY (notice_id, person_id)
	);

	CREATE TABLE countdowns (
		id INTEGER PRIMARY KEY,
		season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
		title TEXT NOT NULL,
		subtitle TEXT NOT NULL DEFAULT '',
		target_at TEXT NOT NULL,
		kind TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('list_deadline', 'exchange', 'custom')),
		hard_lock INTEGER NOT NULL DEFAULT 0,
		visible INTEGER NOT NULL DEFAULT 1,
		passed_at TEXT,
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
	);

	CREATE TABLE reminders (
		id INTEGER PRIMARY KEY,
		season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
		countdown_id INTEGER REFERENCES countdowns(id) ON DELETE CASCADE,
		title TEXT NOT NULL,
		audience TEXT NOT NULL CHECK (audience IN ('everyone', 'list_not_ready', 'not_drawn', 'no_gift_yet')),
		fire_at TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'ready', 'done', 'cancelled')),
		custom_text TEXT,
		draft TEXT,
		post_notice INTEGER NOT NULL DEFAULT 1,
		fired_at TEXT,
		ntfy_result TEXT,
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
	);

	CREATE TABLE reminder_recipients (
		reminder_id INTEGER NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
		person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
		about_json TEXT NOT NULL DEFAULT '[]',
		sent_at TEXT,
		PRIMARY KEY (reminder_id, person_id)
	);

	-- Chat text is sealed because it can name the person someone drew.
	CREATE TABLE chat_turns (
		id INTEGER PRIMARY KEY,
		season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
		person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
		actor_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
		role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'event')),
		sealed TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
	);
	CREATE INDEX chat_turns_person ON chat_turns (season_id, person_id, id);

	-- What Santa has proposed and is waiting for a tap on. The payload is sealed.
	CREATE TABLE pending_actions (
		id TEXT PRIMARY KEY,
		season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
		person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
		kind TEXT NOT NULL,
		sealed TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'failed')),
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
		decided_at TEXT
	);

	CREATE TABLE ai_usage (
		id INTEGER PRIMARY KEY,
		at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
		person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
		purpose TEXT NOT NULL,
		model TEXT NOT NULL,
		input_tokens INTEGER NOT NULL DEFAULT 0,
		output_tokens INTEGER NOT NULL DEFAULT 0,
		cache_read_tokens INTEGER NOT NULL DEFAULT 0,
		cache_write_tokens INTEGER NOT NULL DEFAULT 0,
		web_searches INTEGER NOT NULL DEFAULT 0,
		cost_usd REAL NOT NULL DEFAULT 0
	);
	CREATE INDEX ai_usage_at ON ai_usage (at);

	CREATE TABLE audit_log (
		id INTEGER PRIMARY KEY,
		at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
		actor_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
		action TEXT NOT NULL,
		detail TEXT NOT NULL DEFAULT ''
	);
	`,
	// Tracks which delivered messages have been announced to the organizer's phone. Mail delivered
	// before this change counts as done, so the first start doesn't announce old messages.
	`
	ALTER TABLE thread_messages ADD COLUMN family_ping_done INTEGER NOT NULL DEFAULT 0;
	UPDATE thread_messages SET family_ping_done = 1 WHERE delivered_at IS NOT NULL;
	`
];

let instance: DB | null = null;

function migrate(db: DB): void {
	const current = db.pragma('user_version', { simple: true }) as number;
	for (let version = current; version < MIGRATIONS.length; version++) {
		db.transaction(() => {
			db.exec(MIGRATIONS[version]);
			db.pragma(`user_version = ${version + 1}`);
		})();
	}
}

export function db(): DB {
	if (instance) return instance;
	const file = process.env.DATABASE_FILE ?? resolve(dataDir(), 'santa.db');
	instance = new Database(file);
	instance.pragma('journal_mode = WAL');
	instance.pragma('foreign_keys = ON');
	instance.pragma('busy_timeout = 5000');
	migrate(instance);
	return instance;
}

export function closeDbForTests(): void {
	instance?.close();
	instance = null;
}

export function tx<T>(fn: () => T): T {
	return db().transaction(fn)();
}

export function nowIso(): string {
	return new Date().toISOString();
}
