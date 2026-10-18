// @vitest-environment jsdom
// Every implementation of the page's paging contract, held to one specification: a list already in memory, pages
// fetched as a reader reaches them, and the window of a run over the records it wrote.
import { declareGraphSpec } from "../../test/catalog-fixture.js";
import { ServerUnreachable } from "@haibun/core/lib/rpc-wire.js";
import { beforeEach } from "vitest";
import { LOG_MESSAGE_LABEL } from "@haibun/core/lib/log-message.js";
import { RUN_ARTIFACT_LABEL } from "@haibun/core/lib/run-artifact.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { counted } from "@haibun/core/lib/hypermedia.js";
import { arrayWindowedSource, lazyWindowedSource, MAX_RESIDENT_PAGES, readWindowedSource } from "./windowed-source.js";
import { describeWindowedSource, CONFORMANCE_ROWS } from "../../test/windowed-source-conformance.js";
import { installGraph } from "../client-cache/controllers/device-controller.js";
import { setupShuTest } from "../../test/setup.js";
import { actualityStore } from "../client-cache/actuality-store.test-fake.js";
import { graphActualitySource } from "../client-cache/controllers/actuality-controller.js";
import { endPage } from "../adapters/page-held.js";

type TRow = { name: string };
const named = (row: TRow): string => row.name;
const shouldName = (index: number): string => `row ${index}`;
const rows: TRow[] = Array.from({ length: CONFORMANCE_ROWS }, (_, i) => ({ name: shouldName(i) }));
const marks = [{ index: 0, id: "first", color: "var(--shu-accent)", icon: "◆" }];

describeWindowedSource("a list already in memory", () => ({ source: arrayWindowedSource<TRow>(rows, marks), named, shouldName }));

describeWindowedSource(
	"pages fetched as they are read",
	() => ({
		source: lazyWindowedSource<TRow>({
			count: () => CONFORMANCE_ROWS,
			fetch: async (start, end) => rows.slice(start, end),
			pageSize: 4,
			markers: () => marks,
			maxResidentPages: MAX_RESIDENT_PAGES,
		}),
		named,
		shouldName,
	}),
	{ pages: true },
);

describeWindowedSource(
	"a read whose first page is in hand",
	() => ({
		source: readWindowedSource<TRow>({
			size: 4,
			read: async (start, end) => ({ vertices: rows.slice(start, end), ...counted(CONFORMANCE_ROWS) }),
			held: { vertices: rows.slice(0, 4), ...counted(CONFORMANCE_ROWS) },
			from: 0,
			markers: () => marks,
		}),
		named,
		shouldName,
	}),
	{ pages: true },
);

const RUN = "1700000000000-1";
const iso = (n: number): string => new Date(n).toISOString();

describeWindowedSource("the window of a run", async () => {
	endPage();
	const handle = setupShuTest({
		dispatch: () => {
			throw new ServerUnreachable("/rpc", new Error("this specification reads the records, not a server"));
		},
	});
	declareGraphSpec({ types: [SEQ_PATH_LABEL, LOG_MESSAGE_LABEL, RUN_ARTIFACT_LABEL] });
	const store = actualityStore();
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
	installGraph(store);
	const source = graphActualitySource("info", false);
	await source.ready();
	return { source, named: (row: Record<string, unknown>): string => String(row.in), shouldName, done: () => handle.teardown() };
});

beforeEach(endPage);
