import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LACKS_A_REMEDY, RELAYS_A_CAUGHT_ERROR, refusalFindings, STATES_FEW_WORDS } from "./refusal-rules.js";
import { parsedSources } from "./repository-files.js";

const FILE = "steps.ts";

const made: string[] = [];
afterEach(() => {
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The findings of the refusals a source builds, each with its line. */
function findingsOf(source: string): [string, number | undefined][] {
	const repository = mkdtempSync(join(tmpdir(), "haibun-refusals-"));
	made.push(repository);
	writeFileSync(join(repository, FILE), source);
	return refusalFindings(parsedSources(repository, [FILE])).map(({ finding, line }) => [finding, line]);
}

describe("a step's refusal", () => {
	it("states its cause in its own words, through a const or a template", () => {
		const source = [
			'const MISSING = "the store doesn\'t hold the record";',
			"export const a = () => actionNotOK(MISSING);",
			"export const b = (id: string) => actionNotOK(`the store doesn't hold ${id}`);",
		].join("\n");
		expect(findingsOf(source)).toEqual([]);
	});

	it("is short of its cause where its own words are fewer than a subject, a verb and an object", () => {
		expect(findingsOf('export const a = () => actionNotOK("refused");\nexport const b = (ok: boolean) => actionNotOK(ok ? "the step refused it" : "failed");')).toEqual([
			[STATES_FEW_WORDS, 1],
			[STATES_FEW_WORDS, 2],
		]);
	});

	it("relays another refusal it reads, which states the cause where it was made", () => {
		expect(findingsOf("export const a = (result: { errorMessage: string }) => actionNotOK(result.errorMessage);")).toEqual([]);
	});

	it("is short of its cause where it relays a caught error without stating what failed", () => {
		const source = [
			"export const a = () => { try { return run(); } catch (e) { return actionNotOK(errorDetail(e)); } };",
			"export const b = () => { try { return run(); } catch (e) { return actionNotOK((e as Error).message); } };",
			"export const c = () => run().catch((err) => actionNotOK(String(err)));",
			"export const d = () => { try { return run(); } catch (e) { return actionNotOK(`reading the folder failed: ${errorDetail(e)}`); } };",
		].join("\n");
		expect(findingsOf(source)).toEqual([
			[RELAYS_A_CAUGHT_ERROR, 1],
			[RELAYS_A_CAUGHT_ERROR, 2],
			[RELAYS_A_CAUGHT_ERROR, 3],
		]);
	});
});

describe("a transport's refusal", () => {
	it("is an object a function returns or a response sends, and not an option or a log's detail", () => {
		const source = [
			'export const a = () => ({ error: "nope" });',
			'export const b = (c: { json(body: unknown, status: number): void }) => c.json({ ok: false, error: "bad" }, 400);',
			'export const c = z.number({ error: "invalid" });',
			'export const d = () => log("warn", { error: "x" });',
			'export const e = () => ({ ok: true, error: "x" });',
		].join("\n");
		expect(findingsOf(source)).toEqual([
			[STATES_FEW_WORDS, 1],
			[STATES_FEW_WORDS, 2],
		]);
	});

	it("carries a remedy where it refuses the caller's authority", () => {
		const source = [
			'export const a = (c: { json(body: unknown, status: number): void }) => c.json({ error: "the key doesn\'t verify" }, 403);',
			'export const b = (c: { json(body: unknown, status: number): void }) => c.json({ error: "the key doesn\'t verify", remedy: RELOAD.authority }, 403);',
		].join("\n");
		expect(findingsOf(source)).toEqual([[LACKS_A_REMEDY, 1]]);
	});

	it("carries a remedy where the gate names the action a caller lacks, over RPC, over MCP and as a thrown error", () => {
		const source = [
			"export const a = (method: string) => ({ error: refusal(method, undefined, undefined) });",
			'export const b = (name: string) => ({ isError: true, content: [{ type: "text", text: refusal(name, undefined, undefined) }] });',
			'export const c = (method: string) => { throw new Error(namedRefusal(method, "Example:act")); };',
		].join("\n");
		expect(findingsOf(source)).toEqual([
			[LACKS_A_REMEDY, 1],
			[LACKS_A_REMEDY, 2],
			[LACKS_A_REMEDY, 3],
		]);
	});

	it("reads an MCP result's text and a builder's message, each of which may fall short", () => {
		const source = [
			'export const a = (r: { errorMessage?: string }) => ({ isError: true, content: [{ type: "text", text: r.errorMessage ?? "Step failed" }] });',
			"export const b = (method: string) => { try { return run(); } catch (err) { return callFailed(method, errorDetail(err)); } };",
		].join("\n");
		expect(findingsOf(source)).toEqual([
			[STATES_FEW_WORDS, 1],
			[RELAYS_A_CAUGHT_ERROR, 2],
		]);
	});
});
