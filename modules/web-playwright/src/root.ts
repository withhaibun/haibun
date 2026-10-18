/**
 * The browser's composition root: the pages of a feature, from the browser factory with a holding machine for each context
 * and page; the twin; the files a step reads and leaves; the page's fetch; and the relay a person's browser attaches
 * through, served over the web server's `/rpc`.
 */
import { machine } from "@haibun/core/lib/machine.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import type { AStorage } from "@haibun/domain-storage/domains/storage.js";
import type { IWebServer } from "@haibun/web-server-hono/defs.js";
import { BrowserFactory } from "./adapters/browser-factory.js";
import { BrowserRelay } from "./adapters/cdp-relay.js";
import { diskFiles } from "./adapters/files.js";
import { fetchInPage } from "./adapters/page-fetch.js";
import { relayMethods } from "./adapters/relay-methods.js";
import { RELAY_METHOD_PREFIX } from "./adapters/relay-wire.js";
import { TwinPage } from "./adapters/twin-page.js";
import { HOLDING_EVENT, HOLDING_STATUS, holdingTransition, INITIAL_HOLDING } from "./machines/browser-holding.js";
import type { TBrowserOptions, TBrowserPages, TBrowserRelay, TFiles, THolding, TPageFetch, TPageObserver, TTwin } from "./ports.js";

/** A holding over one browser holding machine. */
function holding(): THolding {
	const held = machine(INITIAL_HOLDING, holdingTransition);
	return {
		opened: () => void held.dispatch({ type: HOLDING_EVENT.OPENED }),
		adopted: () => void held.dispatch({ type: HOLDING_EVENT.ADOPTED }),
		closed: () => void held.dispatch({ type: HOLDING_EVENT.CLOSED }),
		owned: () => held.state.get() === HOLDING_STATUS.OPEN,
	};
}

/** The ports of a stepper's browser. */
export type TBrowserPorts = {
	/** The pages of a feature, obtained with the options as they stand when the feature opens its first page. */
	openPages: () => TBrowserPages;
	files: TFiles;
	fetch: TPageFetch;
	twin: (storage: AStorage, headless: boolean) => Promise<TTwin>;
};

/** The ports of the browser of `world`, whose pages each have the observer `observer` makes for it. */
export function browserPorts(world: TWorld, options: () => TBrowserOptions, observer: (pageKey: string) => TPageObserver): TBrowserPorts {
	return {
		openPages: () => new BrowserFactory(options(), { holding, observer, log: world.eventLogger }),
		files: diskFiles,
		fetch: fetchInPage,
		twin: (storage, headless) => TwinPage.create(world, storage, headless),
	};
}

/** Serves the relay over `webserver`'s `/rpc` as `relay.attach` and `relay.send`, each requiring `attachAction`. */
export function serveRelay(webserver: IWebServer, attachAction: string, onError: (error: unknown) => void): TBrowserRelay {
	const relay = new BrowserRelay(onError);
	webserver.addRpcMethods(RELAY_METHOD_PREFIX, { description: "The browser a person runs, attached through their extension" }, relayMethods(relay, attachAction));
	return relay;
}

/** Closes every browser any feature obtained. */
export const closeBrowsers = (): Promise<void> => BrowserFactory.closeBrowsers();
