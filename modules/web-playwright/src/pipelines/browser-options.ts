/**
 * The browser a feature drives, as its options state it: a running browser to connect to in place of a launch, and an
 * extension to load into the browser actuality launches. Each is set before a step opens a page.
 */
import { actionNotOK, actionOKWithProducts } from "@haibun/core/lib/util/index.js";
import type { TActionResult } from "@haibun/core/lib/domains/protocol.js";
import { z } from "zod";
import { extensionIdOf } from "../derivations/extension.js";
import type { TBrowserOptions, TFiles } from "../ports.js";

/** The profile Playwright makes for the browser and removes when it closes, where a persistent directory isn't named. */
const TEMPORARY_PROFILE = "";
/** The Chromium build that loads extensions in its headless mode, where the headless shell doesn't. */
const EXTENSION_CHANNEL = "chromium";
const EXTENSION_SCHEME = "chrome-extension://";

/** What a manifest declares of an extension: the key that pins its id, its worker, and its side panel. */
const ManifestSchema = z.object({ key: z.string().optional(), background: z.object({ service_worker: z.string().optional() }).optional(), side_panel: z.unknown().optional() });

/** An extension loaded into the browser actuality launches: its id, the origin of its pages, and whether it declares a worker and a side panel. */
export type TLoadedExtension = { id: string; origin: string; worker: boolean; sidePanel: boolean };

/** The options a connected browser ignores, each set or unset: each configures a browser actuality launches. */
export type TLaunchOnly = { CAPTURE_VIDEO: boolean; TWIN: boolean; PERSISTENT_DIRECTORY: boolean };

/** The options that drive a running browser from the next page: the one at a CDP endpoint, or the one attached through the
 *  relay, reached through the transport it makes. */
export function connecting(options: TBrowserOptions, cdp: NonNullable<TBrowserOptions["cdp"]>, launchOnly: TLaunchOnly): { options: TBrowserOptions } | { refusal: string } {
	const set = Object.entries(launchOnly)
		.filter(([, on]) => on)
		.map(([name]) => name);
	if (set.length > 0) return { refusal: `a connected browser ignores ${set.join(", ")}: each configures a browser actuality launches` };
	return { options: { ...options, cdp } };
}

/**
 * The options that load the unpacked extension at `where` into the browser actuality launches. An extension loads only
 * into a browser with a profile of its own, the one `PERSISTENT_DIRECTORY` names or else a temporary one, and only into
 * Chromium's full browser. Its id is the one its manifest's pinned key derives, so a step can open its pages.
 */
export function loadingExtension(files: TFiles, options: TBrowserOptions, where: string): { options: TBrowserOptions; loaded: TLoadedExtension } | { refusal: string } {
	if (options.cdp !== undefined) return { refusal: "an extension loads into a browser actuality launches, and this feature connects to a running browser" };
	const directory = files.resolve(where);
	const manifest = files.manifest(directory);
	if (manifest === undefined) return { refusal: `${directory} doesn't hold an extension: it lacks a manifest.json` };
	const { key, background, side_panel } = ManifestSchema.parse(manifest);
	if (key === undefined) return { refusal: `the extension at ${directory} doesn't pin a key in its manifest, so its id is unknown before it loads` };
	const id = extensionIdOf(key);
	const launchOptions = {
		...options.launchOptions,
		channel: EXTENSION_CHANNEL,
		args: [...options.launchOptions.args, `--disable-extensions-except=${directory}`, `--load-extension=${directory}`],
	};
	const persistentDirectory = options.persistentDirectory === undefined ? TEMPORARY_PROFILE : options.persistentDirectory;
	return {
		options: { ...options, persistentDirectory, launchOptions },
		loaded: { id, origin: `${EXTENSION_SCHEME}${id}`, worker: background?.service_worker !== undefined, sidePanel: side_panel !== undefined },
	};
}

/** The result of a step that loads an extension: its id and origin, or its refusal. */
export const loadedResult = (loading: ReturnType<typeof loadingExtension>): TActionResult =>
	"refusal" in loading ? actionNotOK(loading.refusal) : actionOKWithProducts({ id: loading.loaded.id, origin: loading.loaded.origin });
