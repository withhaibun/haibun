import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { codeKindFindings, kindOf, UNPOSITIONED } from "./code-kinds.js";

const PIPELINE = "src/area/pipelines/read.ts";
const ADAPTER = "src/area/adapters/store.ts";
const PORTS = "src/area/ports.ts";
const ROOT = "src/area/root.ts";
const STEPPER = "src/area/area-stepper.ts";
const VIEW = "src/components/shu-list.ts";
const PACKAGE = "@example/area";

const made: string[] = [];
afterEach(() => {
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A repository holding each file with its source, and the findings of `file` in it. */
function findingsOf(file: string, sources: Record<string, string>): string[] {
	const repository = mkdtempSync(join(tmpdir(), "haibun-code-kinds-"));
	made.push(repository);
	for (const [path, source] of Object.entries(sources)) {
		mkdirSync(join(repository, dirname(path)), { recursive: true });
		writeFileSync(join(repository, path), source);
	}
	return codeKindFindings(repository, { files: [file], packages: { [PACKAGE]: "src/area" } }).map(({ finding }) => finding);
}
const withPorts = (sources: Record<string, string>) => ({ [PORTS]: "export type TStore = { read(): string };\n", [ADAPTER]: "export const store = 1;\n", ...sources });

describe("the kind of a file", () => {
	it("is determined by its kind directory, nearest first, or by its name", () => {
		expect(kindOf("src/area/domains/note.ts")).toBe("domain");
		expect(kindOf("src/area/derivations/title.ts")).toBe("derivation");
		expect(kindOf("src/area/machines/turn.ts")).toBe("machine");
		expect(kindOf(PIPELINE)).toBe("pipeline");
		expect(kindOf("src/area/adapters/http/client.ts")).toBe("adapter");
		expect(kindOf(PORTS)).toBe("port");
		expect(kindOf(ROOT)).toBe("composition root");
		expect(kindOf(STEPPER)).toBe("stepper");
		expect(kindOf(VIEW)).toBe("view");
		expect(kindOf("src/lib/util.ts")).toBeUndefined();
	});
});

describe("a file's findings against the kinds", () => {
	it("name a file outside a kind position, without reading its imports", () => {
		expect(findingsOf("src/lib/util.ts", { "src/lib/util.ts": 'import { readFileSync } from "node:fs";\n' })).toEqual([UNPOSITIONED]);
	});

	it("name a value import of a kind the row doesn't list", () => {
		expect(findingsOf(PIPELINE, withPorts({ [PIPELINE]: 'import { store } from "../adapters/store.js";\n' }))).toEqual(["imports an adapter: ../adapters/store.js"]);
	});

	it("don't name a type import, which every row allows", () => {
		expect(
			findingsOf(PIPELINE, withPorts({ [PIPELINE]: 'import type { store } from "../adapters/store.js";\nimport { type store as s } from "../adapters/store.js";\n' })),
		).toEqual([]);
	});

	it("don't name an import of a kind the row lists, such as a stepper's import of its area's composition root", () => {
		const sources = withPorts({
			[STEPPER]: 'import { read } from "./pipelines/read.js";\nimport { ports } from "./root.js";\n',
			[PIPELINE]: "export const read = 1;\n",
			[ROOT]: 'import { store } from "./adapters/store.js";\nexport const ports = store;\n',
		});
		expect(findingsOf(STEPPER, sources)).toEqual([]);
		expect(findingsOf(ROOT, sources)).toEqual([]);
	});

	it("name a stepper's import of a port's value, or of another area's composition root", () => {
		const sources = withPorts({ [STEPPER]: 'import { ports } from "./ports.js";\nimport { other } from "../other/root.js";\n', "src/other/root.ts": "export const other = 1;\n" });
		expect(findingsOf(STEPPER, sources)).toEqual(["imports a port: ./ports.js", "imports another area's composition root: ../other/root.js"]);
	});

	it("don't name an import of the file's own kind, apart from a stepper's import of another stepper", () => {
		const shared = { "src/components/shu-element.ts": "export class ShuElement {}\n", "src/area/other-stepper.ts": "export const other = 1;\n" };
		expect(findingsOf(VIEW, { ...shared, [VIEW]: 'import { ShuElement } from "./shu-element.js";\n' })).toEqual([]);
		expect(findingsOf(STEPPER, { ...shared, [STEPPER]: 'import { other } from "./other-stepper.js";\n' })).toEqual(["imports a stepper: ./other-stepper.js"]);
	});

	it("resolve a workspace package's import to its source", () => {
		expect(findingsOf(VIEW, withPorts({ [VIEW]: `import { store } from "${PACKAGE}/adapters/store.js";\n` }))).toEqual([`imports an adapter: ${PACKAGE}/adapters/store.js`]);
	});

	it("name I/O outside an adapter, and allow it in one", () => {
		const io = 'import { readFileSync } from "node:fs";\nimport pg from "pg";\nexport const read = () => fetch("https://example.com");\n';
		expect(findingsOf(PIPELINE, { [PIPELINE]: io })).toEqual(["performs I/O through node:fs", "performs I/O through pg", "performs I/O through fetch"]);
		expect(findingsOf(ADAPTER, { [ADAPTER]: io })).toEqual([]);
	});

	it("name a global I/O call through the global object, and not a property, a member, a type or a name the file binds", () => {
		const source = [
			"export const a = () => globalThis.setTimeout(() => undefined, 1);",
			"export const b = (client: { fetch(): void }) => client.fetch();",
			"export type TTimer = ReturnType<typeof setInterval>;",
			"export interface IFetcher { fetch(address: string): void }",
			"export const c = (fetch: () => void) => fetch();",
		].join("\n");
		expect(findingsOf(PIPELINE, { [PIPELINE]: source })).toEqual(["performs I/O through setTimeout"]);
	});
});
