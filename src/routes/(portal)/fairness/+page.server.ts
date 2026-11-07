import { commitments } from '$lib/server/draw';
import { currentSeason, listPairRules, participantIds } from '$lib/server/season';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const season = currentSeason();
	if (!season) return { hasSeason: false as const };
	return {
		hasSeason: true as const,
		rules: {
			guardian: !!season.rule_guardian,
			household: !!season.rule_household,
			noRepeat: !!season.rule_no_repeat,
			noReciprocal: !!season.rule_no_reciprocal,
			// The rule itself is shown, so the family can see nothing was stacked. Private notes aren't.
			custom: listPairRules(season.id).map((rule) => ({
				id: rule.id,
				giver: rule.giver_name,
				receiver: rule.receiver_name,
				bothWays: !!rule.both_ways
			}))
		},
		peopleCount: participantIds(season.id).length,
		spendLimit: season.spend_limit,
		houseRules: season.house_rules,
		commitments: commitments(season.id),
		status: season.status,
		emergencyReveals: season.emergency_reveals
	};
};
