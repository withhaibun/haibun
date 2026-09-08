import { describe, it, expect } from "vitest";
import { generateDocumentMarkdown, buildArtifactIndex, headingAnchor } from "./document-content.js";
import type { THaibunEvent } from "../schema/protocol.js";
import { LifecycleEvent } from "../schema/protocol.js";

function featureEvent(featurePath: string, featureName: string): THaibunEvent {
	return {
		id: "feat-1",
		timestamp: 1000,
		source: "haibun",
		level: "info",
		kind: "lifecycle",
		stage: "start",
		type: "feature",
		featurePath,
		featureName,
		status: "running",
	} as unknown as THaibunEvent;
}

function scenarioEvent(scenarioName: string): THaibunEvent {
	return {
		id: "feat-1.scen-1",
		timestamp: 2000,
		source: "haibun",
		level: "info",
		kind: "lifecycle",
		stage: "start",
		type: "scenario",
		scenarioName,
		status: "running",
	} as unknown as THaibunEvent;
}

describe("what a run said is text", () => {
	const said = (message: string): THaibunEvent => ({ id: "feat-1.1", timestamp: 3000, source: "haibun", level: "info", kind: "log", message }) as unknown as THaibunEvent;
	const ran = (text: string): THaibunEvent =>
		({ id: "feat-1.2", timestamp: 4000, source: "haibun", level: "info", kind: "lifecycle", stage: "end", type: "step", status: "passed", in: text, actionName: "act" }) as unknown as THaibunEvent;

	it("places a message's markup as text, so what a run reported never becomes elements of the document", () => {
		// A failure report quotes the elements it looked at. Placed as markup, those became a list item carrying a
		// test id and three canvases the rendering library sized, which the next run found and pressed.
		const events = [featureEvent("/f.feature", "F"), said(`saw <li data-testid="views-picker-row-x">…</li> and <canvas class="a-canvas"></canvas>`)];
		const { md } = generateDocumentMarkdown(events, buildArtifactIndex(events).artifactsByStep);
		expect(md).not.toContain("<li data-testid");
		expect(md).not.toContain("<canvas");
		expect(md).toContain("&lt;li data-testid=&quot;views-picker-row-x&quot;&gt;");
	});

	it("places a step's own text as text, since a step quotes markup to assert about it", () => {
		const events = [featureEvent("/f.feature", "F"), ran('not text at "/tmp/out.html" contains "<script>alert(1)</script>"')];
		const { md } = generateDocumentMarkdown(events, buildArtifactIndex(events).artifactsByStep);
		expect(md).not.toContain("<script>");
		expect(md).toContain("&lt;script&gt;");
	});
});

describe("generateDocumentMarkdown", () => {
	it("renders Feature: with featureName", () => {
		const events = [featureEvent("/path/to/test.feature", "Test Feature")];
		const { artifactsByStep } = buildArtifactIndex(events);
		const { md } = generateDocumentMarkdown(events, artifactsByStep);
		expect(md).toContain("# Feature: Test Feature");
		expect(md).not.toContain("undefined");
	});

	it("renders Feature: with featurePath when featureName is missing", () => {
		const events = [
			{
				id: "feat-1",
				timestamp: 1000,
				source: "haibun",
				level: "info",
				kind: "lifecycle",
				stage: "start",
				type: "feature",
				featurePath: "/path/to/test.feature",
				status: "running",
			} as unknown as THaibunEvent,
		];
		const { artifactsByStep } = buildArtifactIndex(events);
		const { md } = generateDocumentMarkdown(events, artifactsByStep);
		expect(md).toContain("# Feature: /path/to/test.feature");
		expect(md).not.toContain("undefined");
	});

	it("stamps each heading with its own name, which is what a link to it can be written from", () => {
		const md = generateDocumentMarkdown([featureEvent("/test", "Test"), scenarioEvent("5. Confirming the permit was stored")], new Map(), "info", 1000).md;
		expect(md, "the name a feature author wrote, not the id assigned while running").toContain('data-heading="5-confirming-the-permit-was-stored"');
		expect(md, "and a test id a feature can wait for, from the same name").toContain('data-testid="doc-heading-5-confirming-the-permit-was-stored"');
	});

	it("names a heading by lower case, with every run of anything else one hyphen", () => {
		expect(headingAnchor("8. The border checks the permit, and it passes")).toBe("8-the-border-checks-the-permit-and-it-passes");
		expect(headingAnchor("  Trailing and leading  ")).toBe("trailing-and-leading");
	});

	it("renders Scenario: with scenarioName", () => {
		const events = [featureEvent("/test", "Test"), scenarioEvent("Create issuer identity")];
		const { artifactsByStep } = buildArtifactIndex(events);
		const { md } = generateDocumentMarkdown(events, artifactsByStep);
		expect(md).toContain("## Scenario: Create issuer identity");
		expect(md).not.toContain("undefined");
	});

	it("handles JSON-serialized events (SSE round-trip)", () => {
		const raw = [
			JSON.parse(
				JSON.stringify({
					id: "feat-1",
					timestamp: 1000,
					source: "haibun",
					level: "info",
					kind: "lifecycle",
					stage: "start",
					type: "feature",
					featurePath: "/test.feature",
					featureName: "My Feature",
					status: "running",
				}),
			),
			JSON.parse(
				JSON.stringify({
					id: "feat-1.scen-1",
					timestamp: 2000,
					source: "haibun",
					level: "info",
					kind: "lifecycle",
					stage: "start",
					type: "scenario",
					scenarioName: "My Scenario",
					status: "running",
				}),
			),
		] as THaibunEvent[];
		const { artifactsByStep } = buildArtifactIndex(raw);
		const { md } = generateDocumentMarkdown(raw, artifactsByStep);
		expect(md).toContain("# Feature: My Feature");
		expect(md).toContain("## Scenario: My Scenario");
		expect(md).not.toContain("undefined");
	});

	it("handles events parsed through LifecycleEvent.parse()", () => {
		const featureInput = {
			id: "feat-1",
			timestamp: 1000,
			source: "haibun",
			level: "info",
			kind: "lifecycle",
			stage: "start",
			type: "feature",
			featurePath: "/test.feature",
			featureName: "My Feature",
			status: "running",
		};
		const scenarioInput = {
			id: "feat-1.scen-1",
			timestamp: 2000,
			source: "haibun",
			level: "info",
			kind: "lifecycle",
			stage: "start",
			type: "scenario",
			scenarioName: "My Scenario",
			status: "running",
		};
		const parsedFeature = LifecycleEvent.parse(featureInput);
		const parsedScenario = LifecycleEvent.parse(scenarioInput);
		// Simulate getEvents serialization — only specific fields are passed through
		const serialized = [parsedFeature, parsedScenario].map(({ kind, level, timestamp, id, ...rest }) => {
			const r = rest as Record<string, unknown>;
			return { kind, level, timestamp, id, type: r.type, stage: r.stage, featurePath: r.featurePath, featureName: r.featureName, scenarioName: r.scenarioName };
		}) as THaibunEvent[];
		expect((serialized[0] as Record<string, unknown>).featureName).toBe("My Feature");
		expect((serialized[1] as Record<string, unknown>).scenarioName).toBe("My Scenario");
		const parsed = serialized;
		const { artifactsByStep } = buildArtifactIndex(parsed);
		const { md } = generateDocumentMarkdown(parsed, artifactsByStep);
		expect(md).toContain("# Feature: My Feature");
		expect(md).toContain("## Scenario: My Scenario");
		expect(md).not.toContain("undefined");
	});

	it("never renders undefined in headings", () => {
		const events = [
			{
				id: "feat-1",
				timestamp: 1000,
				source: "haibun",
				level: "info",
				kind: "lifecycle",
				stage: "start",
				type: "feature",
				featurePath: "/test",
				status: "running",
			} as unknown as THaibunEvent,
			{
				id: "feat-1.scen-1",
				timestamp: 2000,
				source: "haibun",
				level: "info",
				kind: "lifecycle",
				stage: "start",
				type: "scenario",
				scenarioName: "Test Scenario",
				status: "running",
			} as unknown as THaibunEvent,
		];
		const { artifactsByStep } = buildArtifactIndex(events);
		const { md } = generateDocumentMarkdown(events, artifactsByStep);
		expect(md).not.toContain("undefined");
	});

	it("emits a fillable holder for a technical step's artifacts regardless of event order", () => {
		// The step claims its artifacts; without a holder div an artifact event that arrives AFTER the step's end would be
		// claimed and then rendered nowhere (the standalone branch skips claimed ids) — visibility must not depend on order.
		const step = (stage: string, ts: number) =>
			({ id: "0.1.2", timestamp: ts, source: "h", level: "log", kind: "lifecycle", stage, type: "step", status: "passed", in: "take a screenshot" }) as unknown as THaibunEvent;
		const image = (ts: number) =>
			({
				id: "0.1.2.artifact.0",
				timestamp: ts,
				source: "h",
				level: "info",
				kind: "artifact",
				artifactType: "image",
				path: "image/x.png",
				mimetype: "image/png",
			}) as unknown as THaibunEvent;
		for (const events of [
			[step("start", 1000), step("end", 1050), image(1060)], // artifact after step end (live stream order)
			[step("start", 1000), image(1020), step("end", 1050)], // artifact between start and end
		]) {
			const { artifactsByStep } = buildArtifactIndex(events);
			const { md } = generateDocumentMarkdown(events, artifactsByStep, "log");
			const holders = md.match(/class="(feature-artifacts|standalone-artifact)"[^>]*(data-ids|data-id)="[^"]*0\.1\.2\.artifact\.0/g) ?? [];
			expect(holders.length).toBe(1);
		}
	});
});
