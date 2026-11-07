import { logAudit } from './audit';
import { createCountdown } from './countdowns';
import { hashPassword } from './crypto';
import { db, tx } from './db';
import { createHousehold, createPerson, setGuardians, setPasswordHash, updatePerson } from './people';
import { planReminders } from './reminders';
import { createSeason, currentSeason, updateSeason } from './season';
import { setSetting } from './settings';
import { addItem, setAmazonUrl, setGuidance, setListReady } from './wishlist';

export const DEMO_PASSWORD = 'jinglebells';

export const DEMO_LOGINS = [
	{ username: 'morgan', name: 'Morgan Frost', note: 'Admin, parent of Ivy and Theo' },
	{ username: 'casey', name: 'Casey Frost', note: 'Parent of Ivy and Theo' },
	{ username: 'jordan', name: 'Jordan Winters', note: 'Parent of Poppy and Max' },
	{ username: 'riley', name: 'Riley Winters', note: 'Parent of Poppy and Max' },
	{ username: 'june', name: 'June Snow', note: 'Grandparent' },
	{ username: 'walt', name: 'Walt Snow', note: 'Grandparent' }
];

/**
 * Fills an empty database with a made-up family of 6 adults and 4 kids, so the whole app can be
 * tried before any real names go in. Only runs when DEMO_MODE is on and the database is empty.
 */
export async function seedDemoIfEmpty(): Promise<boolean> {
	const count = (db().prepare('SELECT COUNT(*) AS n FROM people').get() as { n: number }).n;
	if (count > 0) return false;

	const hash = await hashPassword(DEMO_PASSWORD);
	const inDays = (days: number, hour = 18) => {
		const date = new Date(Date.now() + days * 86_400_000);
		date.setUTCHours(hour, 0, 0, 0);
		return date.toISOString();
	};

	tx(() => {
		setSetting('family_name', 'The Frost, Winters & Snow Family');
		// Short delays and a low budget, so demo testing is quick and cheap.
		setSetting('relay_delay_min', '0');
		setSetting('relay_delay_max', '1');
		setSetting('ai_budget_usd', '5');
		setSetting('santa_daily_cap', '25');

		const frost = createHousehold('The Frosts');
		const winters = createHousehold('The Winters');
		const snow = createHousehold('The Snows');

		const morgan = createPerson({ display_name: 'Morgan Frost', kind: 'adult', household_id: frost.id, is_admin: true, phone: '+15555550101', username: 'morgan', color: 'pine' });
		const casey = createPerson({ display_name: 'Casey Frost', kind: 'adult', household_id: frost.id, phone: '+15555550102', username: 'casey', color: 'cranberry' });
		const ivy = createPerson({ display_name: 'Ivy Frost', kind: 'kid', household_id: frost.id, color: 'plum' });
		const theo = createPerson({ display_name: 'Theo Frost', kind: 'kid', household_id: frost.id, color: 'gold' });
		const jordan = createPerson({ display_name: 'Jordan Winters', kind: 'adult', household_id: winters.id, phone: '+15555550103', username: 'jordan', color: 'midnight' });
		const riley = createPerson({ display_name: 'Riley Winters', kind: 'adult', household_id: winters.id, phone: '+15555550104', username: 'riley', color: 'teal' });
		const poppy = createPerson({ display_name: 'Poppy Winters', kind: 'kid', household_id: winters.id, color: 'rose' });
		const max = createPerson({ display_name: 'Max Winters', kind: 'kid', household_id: winters.id, color: 'copper' });
		const june = createPerson({ display_name: 'June Snow', kind: 'adult', household_id: snow.id, phone: '+15555550105', username: 'june', color: 'rose' });
		const walt = createPerson({ display_name: 'Walt Snow', kind: 'adult', household_id: snow.id, phone: '+15555550106', username: 'walt', color: 'gold' });

		for (const adult of [morgan, casey, jordan, riley, june, walt]) setPasswordHash(adult.id, hash);
		setGuardians(ivy.id, [morgan.id, casey.id]);
		setGuardians(theo.id, [morgan.id, casey.id]);
		setGuardians(poppy.id, [jordan.id, riley.id]);
		setGuardians(max.id, [jordan.id, riley.id]);

		const season = createSeason(`Christmas ${new Date().getFullYear()}`);
		updateSeason(season.id, { spend_limit: '$50' });
		const fresh = currentSeason()!;

		const deadline = createCountdown(season.id, { title: 'Wish lists due', subtitle: 'So your Santa has time to shop', target_at: inDays(14), kind: 'list_deadline' });
		const exchange = createCountdown(season.id, { title: 'Secret Santa day', subtitle: 'Gifts at Grandma and Grandpa\'s house', target_at: inDays(40), kind: 'exchange' });
		void deadline;
		void exchange;
		planReminders(season.id);

		addItem(fresh, ivy.id, { title: 'Watercolor paint set', price_text: '$24', notes: 'She loves the ones with the little palette.', priority: 1 });
		addItem(fresh, ivy.id, { title: 'Horse riding boots', price_text: '$45', notes: 'Kids size 3', priority: 2 });
		addItem(fresh, ivy.id, { title: 'A book about the ocean', priority: 3 });
		setGuidance(ivy.id, { notes: 'Age 9. Loves art and horses. Shirt size kids M. No slime, please.' });

		addItem(fresh, theo.id, { title: 'Dinosaur excavation kit', price_text: '$18', priority: 1 });
		addItem(fresh, theo.id, { title: 'Remote control truck', price_text: '$40', priority: 2 });
		setGuidance(theo.id, { notes: 'Age 6. Dinosaurs, trucks, anything with wheels. Already has the big T-Rex.' });

		addItem(fresh, poppy.id, { title: 'Friendship bracelet kit', price_text: '$15', priority: 2 });
		addItem(fresh, poppy.id, { title: 'Roller skates', price_text: '$48', notes: 'Size 5, purple if possible', priority: 1 });
		setGuidance(poppy.id, { notes: 'Age 11. Crafts and skating. No more stuffed animals.' });

		addItem(fresh, max.id, { title: 'LEGO space set', price_text: '$35', priority: 1 });
		setGuidance(max.id, { notes: 'Age 7. Space and LEGO. Has the shuttle already.' });

		addItem(fresh, morgan.id, { title: 'Cast iron skillet', url: 'https://www.example.com/skillet', price_text: '$35', priority: 1 });
		addItem(fresh, morgan.id, { title: 'Hiking socks', notes: 'Large', priority: 3 });
		addItem(fresh, casey.id, { title: 'Pour-over coffee kit', price_text: '$40', priority: 1 });
		setAmazonUrl(fresh, casey.id, 'https://www.amazon.com/hz/wishlist/ls/DEMOLIST');
		addItem(fresh, jordan.id, { title: 'Bird feeder camera', price_text: '$50', priority: 1 });
		addItem(fresh, riley.id, { title: 'Weighted blanket', price_text: '$45', priority: 2 });
		addItem(fresh, june.id, { title: 'Large-print crossword book', price_text: '$12', priority: 2 });
		addItem(fresh, june.id, { title: 'Herb garden starter', price_text: '$25', priority: 1 });
		addItem(fresh, walt.id, { title: 'Fly-fishing lures', price_text: '$20', priority: 1 });
		setGuidance(walt.id, { notes: 'Prefers practical gifts. Already has plenty of mugs.', helper_notes: 'He just replaced his tackle box, so no need for that.' });

		setListReady(fresh, june, true);
		updatePerson(june.id, {});

		logAudit(morgan.id, 'demo.seeded', 'Created the demo family.');
	});
	return true;
}
