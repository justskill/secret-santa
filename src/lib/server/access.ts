import { error, redirect } from '@sveltejs/kit';
import { isGuardianOf, type Person, wardsOf } from './people';

/**
 * Who is using the app right now.
 * `account` is the adult who signed in. `profile` is whose portal they are viewing: themselves or
 * one of their kids. All game data is scoped to `profile`.
 */
export interface Viewer {
	account: Person;
	profile: Person;
	wards: Person[];
	isAdmin: boolean;
}

export function buildViewer(account: Person, actingId: number, fetchProfile: (id: number) => Person | null): Viewer {
	const wards = wardsOf(account.id);
	let profile = account;
	if (actingId !== account.id && isGuardianOf(account.id, actingId)) {
		profile = fetchProfile(actingId) ?? account;
	}
	return { account, profile, wards, isAdmin: account.is_admin === 1 };
}

export function requireViewer(locals: App.Locals): Viewer {
	if (!locals.viewer) throw redirect(303, '/login');
	return locals.viewer;
}

export function requireAdmin(locals: App.Locals): Viewer {
	const viewer = requireViewer(locals);
	if (!viewer.isAdmin) throw error(403, 'Only the head elf can open this page.');
	return viewer;
}

export function canActAs(viewer: Viewer, personId: number): boolean {
	return viewer.account.id === personId || viewer.wards.some((ward) => ward.id === personId);
}
