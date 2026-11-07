import { giverTag, publishedResults } from '$lib/server/draw';
import { niceListTags, offListStats } from '$lib/server/gifts';
import { getPerson, toPublic } from '$lib/server/people';
import { listSeasons } from '$lib/server/season';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	// The most recent season whose results have been published.
	const season = listSeasons().find((s) => !!s.revealed_at);
	if (!season) return { published: false as const };
	const results = publishedResults(season.id);
	if (!results) return { published: false as const };

	const nice = niceListTags(season.id);
	const person = (id: number) => {
		const found = getPerson(id);
		return found ? toPublic(found) : null;
	};

	return {
		published: true as const,
		seasonName: season.name,
		pairs: results.pairs.map((pair) => ({ giver: person(pair.giverId), receiver: person(pair.receiverId) })),
		proofs: results.proofs,
		stats: offListStats(season.id),
		niceList: results.pairs
			.filter((pair) => nice.has(giverTag(season.id, pair.giverId)))
			.map((pair) => person(pair.giverId))
			.filter((p) => !!p)
	};
};
