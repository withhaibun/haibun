/**
 * shu's steppers held to the typed step graph their baseline records: each finding of the chain lint about them is
 * one the file names, and a finding fixed is removed from it.
 */
import { describe, it } from "vitest";
import path from "node:path";
import { expectStepGraphAsRecorded } from "@haibun/core/lib/test/step-graph-baseline.js";
import Haibun from "@haibun/core/steps/haibun.js";
import AuthorityStepper from "@haibun/core/steps/authority-stepper.js";
import StorageMem from "@haibun/storage-mem/storage-mem.js";
import WebServerStepper from "@haibun/web-server-hono/web-server-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import ClientCacheStepper from "./client-cache/client-cache-stepper.js";
import ShuActivityHistoryControls from "./components/shu-activity-history.controls.js";
import ShuColumnStripControls from "./components/shu-column-strip.controls.js";
import ShuGraphQueryControls from "./components/shu-graph-query.controls.js";
import ShuMonitorColumnControls from "./components/shu-monitor-column.controls.js";
import ShuPolymorphicGraphViewControls from "./components/shu-polymorphic-graph-view.controls.js";
import ShuScrollbarControls from "./components/shu-scrollbar.controls.js";
import GraphSourceStepper from "./graph-source-stepper.js";
import MonitorStepper from "./monitor-stepper.js";
import ShuStepper from "./shu-stepper.js";

describe("the typed step graph of shu's steppers", () => {
	it("has only the findings its baseline records", { timeout: 60_000 }, async () => {
		await expectStepGraphAsRecorded({
			owned: [
				ClientCacheStepper,
				ShuActivityHistoryControls,
				ShuColumnStripControls,
				ShuGraphQueryControls,
				ShuMonitorColumnControls,
				ShuPolymorphicGraphViewControls,
				ShuScrollbarControls,
				GraphSourceStepper,
				MonitorStepper,
				ShuStepper,
			],
			alongside: [Haibun, AuthorityStepper, StorageMem, VariablesStepper, WebServerStepper],
			baselineFile: path.join(import.meta.dirname, "step-graph.baseline.json"),
			sourceDir: import.meta.dirname,
		});
	});
});
