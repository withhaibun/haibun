// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { shuBaseStyles, SHU_BASE, SHU_TOKENS, installShuTokens } from "./styles.js";

describe("the base sheet", () => {
	test("styles shu's own elements and text, and leaves the browser's controls as the browser draws them (CA4D14)", () => {
		expect(SHU_BASE).not.toMatch(/appearance/);
		expect(SHU_BASE).not.toMatch(/(^|[\s,}])(button|input|select|textarea)\b/m);
	});
});

describe("design-token cascade", () => {
	test("SHU_TOKENS owns the token declarations", () => {
		expect(SHU_TOKENS).toMatch(/--shu-bg:\s*#ffffff/);
		expect(SHU_TOKENS).toMatch(/--shu-bg:\s*#161616/);
		expect(SHU_TOKENS).toMatch(/:root\[data-theme="dark"\]/);
	});

	test("SHU_BASE is consumers only: it doesn't declare `--shu-…:`, which would block inheritance from a shadow root", () => {
		expect(SHU_BASE).not.toMatch(/--shu-[a-z0-9-]+:\s*#/);
		expect(SHU_BASE).toMatch(/var\(--shu-bg-/);
		expect(SHU_BASE).toMatch(/var\(--shu-fg/);
	});

	test("shuBaseStyles, the CSSResult components adopt into their shadow root, must NOT re-declare tokens. A `:host { --shu-bg: <default> }` rule inside a shadow tree dams the document-level theme cascade.", () => {
		const cssText = shuBaseStyles.cssText;
		expect(cssText).not.toMatch(/--shu-bg:\s*#/);
		expect(cssText).not.toMatch(/:root\[data-theme=/);
		expect(cssText).toContain("var(--shu-bg");
	});

	test("installShuTokens publishes SHU_TOKENS to document.head exactly once", () => {
		document.getElementById("shu-tokens-root")?.remove();
		installShuTokens();
		installShuTokens();
		const styles = document.querySelectorAll("#shu-tokens-root");
		expect(styles).toHaveLength(1);
		expect(itemAt(styles, 0).textContent).toBe(SHU_TOKENS);
	});
});
