/**
 * Opens the page once its ports are installed. A page a site serves reads the reader's authority first, since each later
 * call is signed with it, requests a delegation from the page that embeds it where one does, and stops at the page's key
 * where the reader may not read. Every page then reads actuality's steps. A page a site serves connects its event stream
 * before a view reads actuality, since a site sends the events after a page connects, and follows the running turns. A
 * reader whose address doesn't name a view is shown the views actuality showed.
 */
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { isServerUnreachable } from "@haibun/core/lib/rpc-wire.js";
import type { TPageAuthority } from "../authority/pipelines/page-authority.js";

/** How the page opened: on actuality, with the views it shows a reader who arrived without an address; at the page's key,
 *  where the reader may not read; or not, with the reason and the build of the page's code. */
export type TPageOpening = { status: "opened"; shown: string[] } | { status: "keyed"; controller: string } | { status: "failed"; reason: string; build: string };

/** What opening the page reads and calls. */
export type TOpenPageScope = {
	/** Whether the page carries a record of actuality, which a site doesn't serve. */
	carried: boolean;
	/** Whether the reader arrived at an address that names views. */
	arrivedWithAddress: boolean;
	openAuthority: () => Promise<TPageAuthority>;
	mayRead: () => boolean;
	/** Requests a delegation to the page's key from the page that embeds it, or undefined where a page doesn't embed it. */
	delegateFromEmbedder: ((controller: string) => Promise<void>) | undefined;
	readSteps: () => Promise<unknown>;
	connect: () => void;
	followTurns: () => void;
	viewsShown: () => Promise<string[]>;
	pageBuild: () => string;
};

/** Opens the page. A page that carries a record of actuality and doesn't carry the site's registry reads without it. */
export async function openPage(scope: TOpenPageScope): Promise<TPageOpening> {
	try {
		if (!scope.carried) {
			const authority = await scope.openAuthority();
			if (scope.delegateFromEmbedder !== undefined) await scope.delegateFromEmbedder(authority.controller);
			if (!scope.mayRead()) return { status: "keyed", controller: authority.controller };
		}
		await scope.readSteps();
	} catch (err) {
		if (!scope.carried || !isServerUnreachable(err)) return { status: "failed", reason: errorDetail(err), build: scope.pageBuild() };
	}
	if (!scope.carried) {
		scope.connect();
		scope.followTurns();
	}
	return { status: "opened", shown: scope.arrivedWithAddress ? [] : await scope.viewsShown() };
}
