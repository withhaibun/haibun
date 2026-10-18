/**
 * The client cache is the page's one path to an actuality. A view reads actuality through an actuality source over the device's store;
 * the graph through the store the page caches it in; the site's declarations through the registry the cache holds. This
 * test fails the build when a second path appears, so the next change extends the cache rather than reaching around it.
 *
 * What it holds to:
 *  - the modules outside the client cache don't build a store of their own,
 *  - the modules don't rebuild the replayed responses a report used to carry,
 *  - a view branching on "is this a report" is a mode, and a mode is a second path.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../../", import.meta.url));
const LIBRARY = "page/client-cache";

/** Every source file of the module, by its path from src, except the library itself and the tests. */
function sources(dir = SRC, from = ""): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		const rel = from ? `${from}/${name}` : name;
		if (statSync(path).isDirectory()) return name === "build" || name === "node_modules" ? [] : sources(path, rel);
		if (!name.endsWith(".ts") || name.endsWith(".test.ts") || name.endsWith(".d.ts")) return [];
		return [rel];
	});
}

const outsideTheLibrary = sources().filter((f) => !f.startsWith(`${LIBRARY}/`));
const text = (f: string): string => readFileSync(join(SRC, f), "utf8");

describe("the client cache is the one path to an actuality", () => {
	it("the files outside the library don't build a store of their own", () => {
		// The test harness installs a store of its own, which is how a test drives the cache; everything else reads through the library.
		const offenders = outsideTheLibrary.filter((f) => f !== "test-setup.ts" && /new (IndexedDbDeviceStore|IndexedDbQuads|MemoryDeviceStore|DeviceGraph)\(/.test(text(f)));
		expect(offenders, `${offenders.join(", ")} builds a store. A store is installed through the client cache (installDeviceStore, installGraph) and read through it.`).toEqual([]);
	});

	it("only the report writer and the boot path read that a page can carry its actuality", () => {
		const allowed = new Set(["monitor-stepper.ts", "domains/hydration.ts", "page/ports.ts", "page/pipelines/hydrate.ts", "page/controllers/hydration-controller.ts"]);
		const offenders = outsideTheLibrary.filter((f) => !allowed.has(f) && /hydrateClientCache|TCachePayload/.test(text(f)));
		expect(
			offenders,
			`${offenders.join(", ")} reads the payload a page carries. Views read actuality through an actuality source, which is the same whether a server or the page carries it.`,
		).toEqual([]);
	});

	it("the views don't check whether this page is a report: a mode is a second path", () => {
		const views = outsideTheLibrary.filter((f) => /(^|\/)components\//.test(f));
		const offenders = views.filter((f) => /isStandaloneMode|getCachedResponse|SerializedConduit/.test(text(f)));
		expect(
			offenders,
			`${offenders.join(", ")} branches on the page being a report. What differs is where the cache was filled from, which the cache settles at boot; the reads are the same.`,
		).toEqual([]);
	});

	it("the files don't serve a page the responses a live actuality received: the replay is gone and stays gone", () => {
		const offenders = outsideTheLibrary.filter((f) => /getCachedResponse|findCachedMethod|setRpcCache|rpc-cache\.js/.test(text(f)));
		expect(
			offenders,
			`${offenders.join(", ")} replays a captured response. A page reads the actuality it carries; what a view showed and actuality does not hold is carried as that view's products.`,
		).toEqual([]);
	});
});
