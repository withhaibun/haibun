import { describe, it, expect } from "vitest";
import { generateDocumentMarkdown, buildArtifactIndex } from "./document-content.js";
import type { THaibunEvent } from "../schema/protocol.js";
import { LifecycleEvent } from "../schema/protocol.js";

function featureEvent(featurePath: string, featureName: string): THaibunEvent {
	return { id: "feat-1", timestamp: 1000, source: "haibun", level: "info", kind: "lifecycle", stage: "start", type: "feature", featurePath, featureName, status: "running" } as unknown as THaibunEvent;
}

function scenarioEvent(scenarioName: string): THaibunEvent {
	return { id: "feat-1.scen-1", timestamp: 2000, source: "haibun", level: "info", kind: "lifecycle", stage: "start", type: "scenario", scenarioName, status: "running" } as unknown as THaibunEvent;
}

describe("generateDocumentMarkdown", () => {
	it("renders Feature: with featureName", () => {
		const events = [featureEvent("/path/to/test.feature", "Test Feature")];
		const { artifactsByStep } = buildArtifactIndex(events);
		const { md } = generateDocumentMarkdown(events, artifactsByStep);
		expect(md).toContain("# Feature: Test Feature");
		expect(md).not.toContain("undefined");
	});

	it("renders Feature: with featurePath when featureName is missing", () => {
		const events = [{ id: "feat-1", timestamp: 1000, source: "haibun", level: "info", kind: "lifecycle", stage: "start", type: "feature", featurePath: "/path/to/test.feature", status: "running" } as unknown as THaibunEvent];
		const { artifactsByStep } = buildArtifactIndex(events);
		const { md } = generateDocumentMarkdown(events, artifactsByStep);
		expect(md).toContain("# Feature: /path/to/test.feature");
		expect(md).not.toContain("undefined");
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
			JSON.parse(JSON.stringify({ id: "feat-1", timestamp: 1000, source: "haibun", level: "info", kind: "lifecycle", stage: "start", type: "feature", featurePath: "/test.feature", featureName: "My Feature", status: "running" })),
			JSON.parse(JSON.stringify({ id: "feat-1.scen-1", timestamp: 2000, source: "haibun", level: "info", kind: "lifecycle", stage: "start", type: "scenario", scenarioName: "My Scenario", status: "running" })),
		] as THaibunEvent[];
		const { artifactsByStep } = buildArtifactIndex(raw);
		const { md } = generateDocumentMarkdown(raw, artifactsByStep);
		expect(md).toContain("# Feature: My Feature");
		expect(md).toContain("## Scenario: My Scenario");
		expect(md).not.toContain("undefined");
	});

	it("handles events parsed through LifecycleEvent.parse()", () => {
		const featureInput = { id: "feat-1", timestamp: 1000, source: "haibun", level: "info", kind: "lifecycle", stage: "start", type: "feature", featurePath: "/test.feature", featureName: "My Feature", status: "running" };
		const scenarioInput = { id: "feat-1.scen-1", timestamp: 2000, source: "haibun", level: "info", kind: "lifecycle", stage: "start", type: "scenario", scenarioName: "My Scenario", status: "running" };
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
			{ id: "feat-1", timestamp: 1000, source: "haibun", level: "info", kind: "lifecycle", stage: "start", type: "feature", featurePath: "/test", status: "running" } as unknown as THaibunEvent,
			{ id: "feat-1.scen-1", timestamp: 2000, source: "haibun", level: "info", kind: "lifecycle", stage: "start", type: "scenario", scenarioName: "Test Scenario", status: "running" } as unknown as THaibunEvent,
		];
		const { artifactsByStep } = buildArtifactIndex(events);
		const { md } = generateDocumentMarkdown(events, artifactsByStep);
		expect(md).not.toContain("undefined");
	});
});
