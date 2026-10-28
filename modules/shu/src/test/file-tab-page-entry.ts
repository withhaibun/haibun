/**
 * The entry of the page a file tab integration test serves, hydrated as a server hydrates a page. It holds quads on the
 * device and holds them again, one write after another, as a page holds what each window reads: each write first reads what
 * the device holds of every quad, in one transaction of many requests. The page counts each write and keeps each failure,
 * and its button opens a PDF in a tab.
 */
import { MEDIA_TYPE } from "@haibun/core/lib/domains/media-types.js";
import { serveThePage } from "./setup.js";
import { showFile } from "../page/controllers/file-controller.js";
import { deviceQuads } from "../page/client-cache/root.js";
import { FILE_TAB_PAGE } from "./file-tab-routes.js";

/** How many quads the page holds, each read with two requests of the read before each write. */
const HELD = 500;
serveThePage();
const failures: string[] = [];
const quads = deviceQuads(`file-tab-${crypto.randomUUID()}`);
const facts = Array.from({ length: HELD }, (_, n) => ({ subject: `s${n}`, predicate: "content", object: `text ${n}`, namedGraph: "Comment", timestamp: n }));
let reads = 0;
Object.defineProperty(globalThis, FILE_TAB_PAGE.reads, { get: () => reads });
Object.assign(globalThis, { [FILE_TAB_PAGE.failures]: failures });

const button = document.createElement("button");
button.id = FILE_TAB_PAGE.open;
button.addEventListener("click", () => showFile(new Blob(["%PDF-1.4\n%%EOF"], { type: MEDIA_TYPE.pdf }), "a.pdf", "page=2"));
document.body.append(button);

for (;;) {
	await quads.setMany(facts).catch((err: unknown) => failures.push(`holding the quads again: ${String(err)}`));
	reads += 1;
}
