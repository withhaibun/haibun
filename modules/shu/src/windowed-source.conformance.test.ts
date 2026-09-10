// @vitest-environment jsdom
// Every implementation of the page's paging contract, held to one specification: a list already in memory, pages
// fetched as a reader reaches them, and the window of a run over the records it wrote.
import { beforeEach } from "vitest";
import { QuadStore } from "@haibun/core/lib/quad-store.js";
import { LOG_MESSAGE_LABEL } from "@haibun/core/lib/log-message.js";
import { RUN_ARTIFACT_LABEL } from "@haibun/core/lib/run-artifact.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { arrayWindowedSource, lazyWindowedSource, readWindowedSource } from "./windowed-source.js";
import { describeWindowedSource, CONFORMANCE_ROWS } from "./test/windowed-source-conformance.js";
import { setGraphStore } from "./quads-snapshot.js";
import { setSiteMetadata, type SiteMetadata } from "./rels-cache.js";
import { setupShuTest } from "./test-setup.js";
import { graphRunSource, resetGraphRunSources } from "./client-cache/graph-run-source.js";

type TRow = { name: string };
const named = (row: TRow): string => row.name;
const shouldName = (index: number): string => `row ${index}`;
const rows: TRow[] = Array.from({ length: CONFORMANCE_ROWS }, (_, i) => ({ name: shouldName(i) }));
const marks = [{ index: 0, id: "first", color: "var(--shu-accent)", icon: "◆" }];

describeWindowedSource("a list already in memory", () => ({ source: arrayWindowedSource<TRow>(rows, marks), named, shouldName }));

describeWindowedSource(
	"pages fetched as they are read",
	() => ({
		source: lazyWindowedSource<TRow>({ count: () => CONFORMANCE_ROWS, fetch: async (start, end) => rows.slice(start, end), pageSize: 4, markers: () => marks }),
		named,
		shouldName,
	}),
	{ pages: true },
);

describeWindowedSource(
	"a read whose first page is in hand",
	() => ({
		source: readWindowedSource<TRow>({ total: () => CONFORMANCE_ROWS, size: 4, read: async (start, end) => rows.slice(start, end), held: rows.slice(0, 4), markers: () => marks }),
		named,
		shouldName,
	}),
	{ pages: true },
);

const RUN = "1700000000000-1";
const STORE_KEY = "__SHU_QUADS_SNAPSHOT_STORE__";
const iso = (n: number): string => new Date(n).toISOString();

describeWindowedSource("the window of a run", async () => {
	delete (globalThis as unknown as Record<string, unknown>)[STORE_KEY];
	resetGraphRunSources();
	const handle = setupShuTest({
		dispatch: () => {
			throw new Error("this specification reads the records, not a server");
		},
	});
	setSiteMetadata({
		types: [SEQ_PATH_LABEL, LOG_MESSAGE_LABEL, RUN_ARTIFACT_LABEL],
		rels: { [SEQ_PATH_LABEL]: {}, [LOG_MESSAGE_LABEL]: {}, [RUN_ARTIFACT_LABEL]: {} },
		edgeRanges: {},
	} as unknown as SiteMetadata);
	const store = new QuadStore();
	for (let i = 0; i < CONFORMANCE_ROWS; i++) {
		await store.upsertIndividual(SEQ_PATH_LABEL, {
			id: `${RUN}.0.${i}`,
			stepText: shouldName(i),
			actionStatus: "passed",
			level: "info",
			generatedAtTime: iso(1000 + i),
			endedAtTime: iso(1000 + i),
			recordedAtTime: iso(1000 + i),
		});
	}
	setGraphStore(store);
	const source = graphRunSource("info");
	await source.ready();
	return { source, named: (row: Record<string, unknown>): string => String(row.in), shouldName, done: () => handle.teardown() };
});

beforeEach(() => resetGraphRunSources());
