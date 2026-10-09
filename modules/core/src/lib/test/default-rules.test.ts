import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { COMPOSE_DEFAULT, DESTRUCTURED_DEFAULT, defaultFindings, FILLS_ABSENT, FILLS_FALSY, PARAMETER_DEFAULT, SCHEMA_DEFAULT } from "./default-rules.js";

const FILE = "source.ts";
const COMPOSE = "docker-compose.yml";

const made: string[] = [];
afterEach(() => {
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The findings of a source file and a compose file, each with its line. */
function findingsOf(source: string, compose?: string): [string, number | undefined][] {
	const repository = mkdtempSync(join(tmpdir(), "haibun-defaults-"));
	made.push(repository);
	writeFileSync(join(repository, FILE), source);
	if (compose !== undefined) writeFileSync(join(repository, COMPOSE), compose);
	return defaultFindings(repository, [FILE], compose === undefined ? [] : [COMPOSE]).map(({ finding, line }) => [finding, line]);
}

describe("a default value in source", () => {
	it("is each constant that ?? and ??= substitute for an absent value", () => {
		const source = [
			'const LEVEL = "private";',
			"const fallback = LEVEL;",
			'export const a = (x?: string) => x ?? "public";',
			"export const b = (x?: number) => x ?? -1;",
			"export const c = (x?: string[]) => x ?? [];",
			"export const d = (x?: Map<string, string>) => x ?? new Map();",
			"export const e = (x?: string) => x ?? Access.public;",
			"export const f = (x?: string) => x ?? MAX_PAGE_ROWS;",
			"export const g = (x?: string) => x ?? fallback;",
			"export const h = (m: Record<string, string[]>, k: string) => (m[k] ??= []);",
			"export const i = (x?: boolean, y?: boolean) => x ?? (y ? true : false);",
		].join("\n");
		expect(findingsOf(source)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11].map((line) => [FILLS_ABSENT, line]));
	});

	it("is each constant that || and ||= substitute for a falsy value", () => {
		expect(findingsOf('export const a = (x: string) => x || "none";\nexport const b = (x: { n: number }) => (x.n ||= 0);')).toEqual([
			[FILLS_FALSY, 1],
			[FILLS_FALSY, 2],
		]);
	});

	it("is a parameter's initializer, a destructured initializer and a schema's default", () => {
		const source = [
			"export function a(limit = 10) { return limit; }",
			"export const b = ({ level = Access.private }: { level?: string }) => level;",
			"export const { c = 1 } = read();",
			'export const d = z.string().default("info");',
		].join("\n");
		expect(findingsOf(source)).toEqual([
			[PARAMETER_DEFAULT, 1],
			[DESTRUCTURED_DEFAULT, 2],
			[DESTRUCTURED_DEFAULT, 3],
			[SCHEMA_DEFAULT, 4],
		]);
	});

	it("isn't an absence stated by name, a computed value or another value of the caller's", () => {
		const source = [
			"export const a = (x?: string) => x ?? undefined;",
			"export const b = (x?: string) => x ?? null;",
			"export const c = (x: string | undefined, y: string) => x ?? y;",
			"export const d = (x: string | undefined) => x ?? describe(x);",
			"export const e = (x: string | undefined, other: { level: string }) => x ?? other.level;",
			"export const f = (x?: string) => (x === undefined ? refuse() : x);",
		].join("\n");
		expect(findingsOf(source)).toEqual([]);
	});
});

describe("a default value in a compose file", () => {
	it("is each variable that states a value for its absence, and a required variable isn't", () => {
		const compose = ["services:", "  app:", "    environment:", "      - PORT=${PORT:-8080}", "      - LEVEL=${LEVEL-info}", "      - KEY=${KEY:?KEY must be set in .env}"].join(
			"\n",
		);
		expect(findingsOf("", compose)).toEqual([
			[COMPOSE_DEFAULT, 4],
			[COMPOSE_DEFAULT, 5],
		]);
	});
});
