import { requireViewer } from '$lib/server/access';
import { importAmazonList } from '$lib/server/linkpreview';
import { currentSeason } from '$lib/server/season';
import { getListMeta } from '$lib/server/wishlist';
import type { RequestHandler } from './$types';

const REASONS = {
	not_amazon: "That doesn't look like an Amazon list link.",
	blocked:
		"Amazon wouldn't let the elves in, which happens a lot. Your link still works for your Santa. To get the items on this page too, open your Amazon list, select everything, copy it, and paste it into \"Paste a whole list\".",
	empty:
		'The elves got in but found nothing. Make sure the list is set to Public or Shared. You can also copy the page and paste it into "Paste a whole list".'
};

export const POST: RequestHandler = async ({ locals }) => {
	const viewer = requireViewer(locals);
	const season = currentSeason();
	const url = season ? getListMeta(season.id, viewer.profile.id).amazon_url : null;
	if (!url) return Response.json({ message: 'Save your Amazon list link first.' }, { status: 400 });

	const result = await importAmazonList(url);
	if (!result.ok) return Response.json({ message: REASONS[result.reason] }, { status: 502 });
	return Response.json({ items: result.items });
};
