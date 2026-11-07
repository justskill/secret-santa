import { error } from '@sveltejs/kit';
import { requireViewer } from '$lib/server/access';
import { myRecipient } from '$lib/server/draw';
import { rewriteForRelay, type RelayPurpose } from '$lib/server/santa/writing';
import { currentSeason } from '$lib/server/season';
import type { RequestHandler } from './$types';

const PURPOSES: RelayPurpose[] = ['question_to_person', 'question_to_helper', 'permission_slip', 'follow_up'];

const WINDOW_MS = 24 * 3_600_000;
const MAX_PER_DAY = 40;
const uses = new Map<number, number[]>();

/** Keeps a stuck button or a playful relative from running up the AI bill. */
function allowed(profileId: number): boolean {
	const recent = (uses.get(profileId) ?? []).filter((at) => Date.now() - at < WINDOW_MS);
	if (recent.length >= MAX_PER_DAY) return false;
	recent.push(Date.now());
	uses.set(profileId, recent);
	return true;
}

/** Rewords a message so the sender can check it before anything is sent. Sends nothing itself. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const viewer = requireViewer(locals);
	const season = currentSeason();
	if (!season) throw error(409, 'There is no season running.');
	const recipient = myRecipient(season.id, viewer.profile.id);
	if (!recipient) throw error(409, 'Open your name first.');

	const body = (await request.json().catch(() => ({}))) as { text?: unknown; purpose?: unknown };
	const text = typeof body.text === 'string' ? body.text.trim().slice(0, 2000) : '';
	const purpose = PURPOSES.find((candidate) => candidate === body.purpose);
	if (!text || !purpose) throw error(400, 'There is nothing to reword.');

	if (!allowed(viewer.profile.id)) {
		return Response.json({
			text,
			rewritten: false,
			notes: ["Santa has reworded a lot today, so this goes exactly as you wrote it. Read it over for anything that gives you away."]
		});
	}

	return Response.json(
		await rewriteForRelay({
			text,
			purpose,
			senderName: viewer.profile.display_name,
			subjectName: recipient.display_name
		})
	);
};
