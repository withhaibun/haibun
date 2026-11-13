// @vitest-environment jsdom
/**
 * A step's row, as actuality's document renders it from the records a page holds: a prose line is prose, which renders as
 * markdown, and a step line is a step's row.
 */
import { describe, it, expect } from "vitest";
import { generateDocumentMarkdown } from "@haibun/core/lib/domains/document-content.js";
import { calledOf } from "@haibun/core/lib/seq-path.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import type { THaibunEvent } from "@haibun/core/lib/domains/protocol.js";
import { renderRefBody } from "../../derivations/markdown-render.js";
import { asRendered } from "./rendered-rows.js";
import { rowOfRecord, type TActualityRow } from "./actuality-rows.js";

const refs = { isType: () => false, propertyDefinition: () => undefined };

const RUN = "1700000000000-1";
/** The row of a step's record: its text, and the stepper and action it called. */
const stepRow = (i: number, stepText: string, called: string): TActualityRow =>
	rowOfRecord(SEQ_PATH_LABEL, {
		id: `${RUN}.0.1.${i}`,
		stepText,
		called,
		actionStatus: "passed",
		accessLevel: "private",
		level: "info",
		generatedAtTime: new Date(i).toISOString(),
	});

describe("a step's row in actuality's document", () => {
	it("names its stepper and its action apart, as actuality's event of the step does", () => {
		expect(asRendered(stepRow(1, "set x to 1", calledOf("VariablesStepper", "set")))).toMatchObject({ stepperName: "VariablesStepper", actionName: "set" });
	});

	it("renders a prose line as markdown paragraphs, and a step line as a step's row", () => {
		const rows = [stepRow(1, "A person reads this *prose*.", calledOf("Haibun", "prose")), stepRow(2, "set x to 1", calledOf("VariablesStepper", "set"))];
		const events = rows.map(asRendered) as unknown as THaibunEvent[];
		const template = document.createElement("template");
		template.innerHTML = renderRefBody(generateDocumentMarkdown(events, "info", 0).md, refs);
		const prose = template.content.querySelector(".prose-block");
		expect(prose?.querySelector("p")?.innerHTML, "prose renders as a paragraph of markdown").toBe("A person reads this <em>prose</em>.");
		expect(template.content.querySelector("pre"), "prose doesn't render as preformatted text").toBeNull();
		expect([...template.content.querySelectorAll(".log-row")].map((row) => row.textContent)).toEqual(["set x to 1"]);
	});
});
