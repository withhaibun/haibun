/**
 * The client cache is the page's one path to a run. A view reads the run through a run source over the device's store;
 * the graph through the store the page caches it in; the site's declarations through the registry the cache holds. This
 * test fails the build when a second path appears, so the next change extends the cache rather than reaching around it.
 *
 * What it holds to:
 *  - nothing outside the client cache builds a store of its own,
 *  - nothing rebuilds the replayed responses a report used to carry,
 *  - a view branching on "is this a report" is a mode, and a mode is a second path.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../", import.meta.url));
const LIBRARY = "client-cache";

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

describe("the client cache is the one path to a run", () => {
	it("no file outside the library builds a store of its own", () => {
		// The test harness installs a store of its own, which is how a test drives the cache; everything else asks the library.
		const offenders = outsideTheLibrary.filter((f) => f !== "test-setup.ts" && /new (IndexedDbDeviceStore|IndexedDbQuadStore|MemoryDeviceStore)\(/.test(text(f)));
		expect(offenders, `${offenders.join(", ")} builds a store. A store is installed through the client cache (setDeviceStore, setGraphStore) and read through it.`).toEqual([]);
	});

	it("only the report writer and the boot path know a page can carry its run", () => {
		const allowed = new Set(["app.ts", "rpc-registry.ts", "monitor-stepper.ts"]);
		const offenders = outsideTheLibrary.filter((f) => !allowed.has(f) && /hydrateClientCache|TCachePayload/.test(text(f)));
		expect(offenders, `${offenders.join(", ")} reads the payload a page carries. Views read the run through a run source, which is the same whether the run came from a server or from the page.`).toEqual([]);
	});

	it("no view asks whether this page is a report: a mode is a second path", () => {
		const views = outsideTheLibrary.filter((f) => f.startsWith("components/"));
		const offenders = views.filter((f) => /isStandaloneMode|getCachedResponse|SerializedConduit/.test(text(f)));
		expect(
			offenders,
			`${offenders.join(", ")} branches on the page being a report. What differs is where the cache was filled from, which the cache settles at boot; the reads are the same.`,
		).toEqual([]);
	});

	it("nothing serves a page answers a live run received: the replay is gone and stays gone", () => {
		const offenders = outsideTheLibrary.filter((f) => /getCachedResponse|findCachedMethod|setRpcCache|rpc-cache\.js/.test(text(f)));
		expect(offenders, `${offenders.join(", ")} replays a captured response. A page reads the run it carries; what a view showed and the run does not say is carried as that view's products.`).toEqual([]);
	});
});
