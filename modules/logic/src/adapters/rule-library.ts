/**
 * The rule sets a reasoning reads, each an N3 file: the logic module's under `src/rules` by name, and another module's by its URL.
 * Each is read once and parsed by N3.js when first read, so an error in a rule fails as its set loads, naming the set.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Parser } from "n3";
import { MEDIA_TYPE } from "@haibun/core/lib/domains/media-types.js";
import { errorDetail } from "@haibun/core/lib/domains/util.js";
import type { TRuleSource } from "../domains/reasoning.js";

/** Returns the text of each rule set by its name or its URL, read and parsed on its first request. */
export function ruleLibrary(): (set: TRuleSource) => string {
	const held = new Map<string, string>();
	return (set) => {
		const file = set instanceof URL ? set : pathToFileURL(createRequire(import.meta.url).resolve(`@haibun/logic/rules/${set}.n3`));
		const read = held.get(file.href);
		if (read !== undefined) return read;
		const text = readFileSync(file, "utf-8");
		try {
			new Parser({ format: MEDIA_TYPE.n3 }).parse(text);
		} catch (caught) {
			throw new Error(`the rule set ${file.href} isn't N3 that N3.js reads: ${errorDetail(caught)}. Correct its rules.`);
		}
		held.set(file.href, text);
		return text;
	};
}
