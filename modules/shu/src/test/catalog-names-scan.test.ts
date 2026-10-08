import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains.js";
import { buildConcernCatalog } from "@haibun/core/lib/hypermedia.js";
import { LinkRelations } from "@haibun/core/lib/resources.js";
import { persistedTypeDefinition } from "../test-setup.js";
import { catalogNameFindings, catalogNames } from "./catalog-names-scan.js";

const NOTE = "Note";
const VIEW = "src/components/shu-note.ts";
const DECLARATION = "src/domains/note.ts";
const names = catalogNames(
	buildConcernCatalog(
		mapDefinitionsToDomains([persistedTypeDefinition(NOTE, { properties: { attributedTo: LinkRelations.ATTRIBUTED_TO.rel, content: LinkRelations.CONTENT.rel } })]),
	),
);

const made: string[] = [];
afterEach(() => {
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The names a view's source names, read in a repository that holds the view and the declaration it imports. */
function namesIn(view: string): [string, number | undefined][] {
	const repository = mkdtempSync(join(tmpdir(), "haibun-catalog-names-"));
	made.push(repository);
	const sources = { [VIEW]: view, [DECLARATION]: `export const NOTE_LABEL = "${NOTE}";\nexport const BY = "attributedTo" as const;\nexport const TITLE = "title";\n` };
	for (const [path, source] of Object.entries(sources)) {
		mkdirSync(join(repository, dirname(path)), { recursive: true });
		writeFileSync(join(repository, path), source);
	}
	return catalogNameFindings(repository, { files: [VIEW], packages: {}, names }).map(({ finding, line }) => [finding, line]);
}

describe("the names a catalog supplies", () => {
	it("are each persisted type's label and each field named by a compound term", () => {
		expect([...names.types]).toEqual([NOTE]);
		expect([...names.fields].sort()).toEqual(["accessLevel", "attributedTo", "generatedAtTime"]);
	});
});

describe("a view's names", () => {
	it("include a type's label as a string and a compound field name as a string, a property read or a destructured binding", () => {
		const view = [
			`export const label = "${NOTE}";`,
			'export const sortBy = ["generatedAtTime"];',
			"export const by = (record: { attributedTo: string }) => record.attributedTo;",
			"export const at = ({ generatedAtTime }: { generatedAtTime: string }) => generatedAtTime;",
		].join("\n");
		expect(namesIn(view)).toEqual([
			["type Note", 1],
			["field generatedAtTime", 2],
			["field attributedTo", 3],
			["field generatedAtTime", 4],
		]);
	});

	it("include a use of an imported const that holds a type's label or a field's name", () => {
		const view = 'import { BY, NOTE_LABEL, TITLE } from "../domains/note.js";\nexport const ref = { type: NOTE_LABEL, by: BY, title: TITLE };';
		expect(namesIn(view)).toEqual([
			["type Note", 2],
			["field attributedTo", 2],
		]);
	});

	it("don't include a one-word field, the element's own property or state, or a module's name", () => {
		const view = [
			'import type { NOTE_LABEL } from "../domains/note.js";',
			'export class ShuNote { state = { attributedTo: "" }; attributedTo = "";',
			"  render(record: { content: string }) { const { attributedTo } = this.state; return [record.content, this.attributedTo, this.state.attributedTo, attributedTo]; } }",
		].join("\n");
		expect(namesIn(view)).toEqual([]);
	});
});
