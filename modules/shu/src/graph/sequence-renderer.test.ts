import { describe, it, expect } from "vitest";
import { sequenceToSvg, sequenceToText, type TSeqModel } from "./sequence-renderer.js";

const model: TSeqModel = {
	actors: [
		{ id: "Feature", label: "Feature" },
		{ id: "Local", label: "Local" },
		{ id: "remote.example", label: "remote.example" },
	],
	messages: [
		{ from: "Feature", to: "Local", label: "stepA (3ms)", kind: "call" },
		{ from: "Local", to: "Feature", label: "ok {x}", kind: "return" },
		{ from: "Feature", to: "remote.example", label: "stepB", kind: "denied", note: "denied: cap-write" },
	],
};

describe("sequenceToSvg", () => {
	it("emits one lifeline+header per actor and one g.seq-message[data-index] per message, ordered top to bottom", () => {
		const svg = sequenceToSvg(model);
		for (const id of ["Feature", "Local", "remote.example"]) expect(svg).toContain(`data-actor-id="${id}"`);
		expect((svg.match(/class="seq-lifeline"/g) ?? []).length).toBe(3);
		expect((svg.match(/class="seq-message"/g) ?? []).length).toBe(3);
		for (const i of [0, 1, 2]) expect(svg).toContain(`data-index="${i}"`);
		// row y increases with index
		const y = (i: number) =>
			Number(svg.match(new RegExp(`data-index="${i}"[^]*?y1="([0-9.]+)"`))?.[1] ?? svg.match(new RegExp(`data-index="${i}"[^]*?d="M[0-9.]+,([0-9.]+)`))?.[1]);
		expect(y(1)).toBeGreaterThan(y(0));
		expect(y(2)).toBeGreaterThan(y(1));
	});

	it("styles kinds: return is dashed, denied is red with a ✕ and no arrow, call carries the arrow marker", () => {
		const svg = sequenceToSvg(model);
		const call = svg.slice(svg.indexOf('data-index="0"'), svg.indexOf('data-index="1"'));
		const ret = svg.slice(svg.indexOf('data-index="1"'), svg.indexOf('data-index="2"'));
		const deny = svg.slice(svg.indexOf('data-index="2"'));
		expect(call).toContain("marker-end=");
		expect(ret).toContain('stroke-dasharray="5 3"');
		expect(deny).toContain("✕");
		expect(deny).not.toContain("marker-end=");
		expect(deny).toContain("denied: cap-write");
	});

	it("is deterministic (same model → identical markup)", () => {
		expect(sequenceToSvg(model)).toBe(sequenceToSvg(model));
	});
});

describe("sequenceToText", () => {
	it("serialises actors and arrow-typed messages, and is deterministic", () => {
		const txt = sequenceToText(model);
		expect(txt).toContain("actor Feature");
		expect(txt).toContain("Feature -> Local: stepA (3ms)");
		expect(txt).toContain("Local --> Feature: ok {x}");
		expect(txt).toContain("Feature -x remote.example: stepB  // denied: cap-write");
		expect(sequenceToText(model)).toBe(sequenceToText(model));
	});
});
