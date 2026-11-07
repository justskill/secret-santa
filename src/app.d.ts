import type { Viewer } from '$lib/server/access';

declare global {
	/** The version in package.json when this was built. */
	const __APP_VERSION__: string;

	namespace App {
		interface Locals {
			viewer: Viewer | null;
			sessionToken: string | null;
		}
		interface Error {
			message: string;
		}
	}
}

export {};
