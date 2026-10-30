/**
 * The rule sets of the logic module, each an N3 file under `src/rules`, read once and parsed by N3.js when first read, so an
 * error in a rule fails as its set loads, naming the set.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Parser } from "n3";
import { MEDIA_TYPE } from "@haibun/core/lib/domains/media-types.js";
import type { TRuleSet } from "../domains/reasoning.js";

/** Returns the text of each rule set by its name, read and parsed on its first request. */
export function ruleLibrary(): (set: TRuleSet) => string {
	const held = new Map<TRuleSet, string>();
	return (set) => {
		const read = held.get(set);
		if (read !== undefined) return read;
		const text = readFileSync(createRequire(import.meta.url).resolve(`@haibun/logic/rules/${set}.n3`), "utf-8");
		try {
			new Parser({ format: MEDIA_TYPE.n3 }).parse(text);
		} catch (caught) {
			throw new Error(`the rule set ${set} isn't N3 that N3.js reads: ${caught instanceof Error ? caught.message : String(caught)}. Correct src/rules/${set}.n3 in @haibun/logic.`);
		}
		held.set(set, text);
		return text;
	};
}
