import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { proseFindings } from "./prose-baseline.js";

const BREAKS = "The function knows the record.\n";
const ALLOWED = "The rule names the verb it knows.";

const made: string[] = [];
afterEach(() => {
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function aRepository(files: Record<string, string>): string {
	const repository = mkdtempSync(join(tmpdir(), "haibun-prose-"));
	made.push(repository);
	execFileSync("git", ["init", "--quiet"], { cwd: repository });
	for (const [path, contents] of Object.entries(files)) {
		mkdirSync(join(repository, dirname(path)), { recursive: true });
		writeFileSync(join(repository, path), contents);
	}
	return repository;
}

describe("a repository's prose findings", () => {
	it("are each violation under the roots by file, rule and line, apart from what is allowed, excluded or ignored", () => {
		const allowance = { persons: [], entries: [{ file: "docs/rules.md", rule: "anthropomorphic", text: ALLOWED, reason: "The rule names the verb it bans." }] };
		const repository = aRepository({
			".gitignore": "docs/proposed/\n",
			"docs/a.md": `# Notes\n\n${BREAKS}`,
			"docs/rules.md": `${ALLOWED}\n`,
			"docs/draft.md": BREAKS,
			"docs/proposed/b.md": BREAKS,
			"prose.allowed.json": JSON.stringify(allowance),
		});
		const found = proseFindings(repository, { roots: ["docs"], exclude: [/^docs\/draft\.md$/], allowedFile: join(repository, "prose.allowed.json") });
		expect(found).toEqual([{ file: "docs/a.md", finding: "anthropomorphic", line: 3 }]);
	});
});
