import { AStepper, IHasCycles, StepperKinds } from "../lib/astepper.js";
import { getStepperOption } from "../lib/util/index.js";
import { shownLogLevel, type THaibunEvent, type TShownLogLevel } from "../schema/protocol.js";
import { EventFormatter } from "../monitor/index.js";

/**
 * ConsoleMonitorStepper - Console monitor using the onEvent pattern.
 */
export default class ConsoleMonitorStepper extends AStepper implements IHasCycles {
	description = "Display lifecycle and log events to console";

	kind = StepperKinds.MONITOR;
	steps = {};

	options = {
		CONSOLE_MONITOR_VERBOSE: {
			desc: "Show all events including step starts",
			parse: (s: string) => ({ result: s === "true" }),
		},
		CONSOLE_MONITOR_LOGS: {
			desc: "Show log events (default: true)",
			parse: (s: string) => ({ result: s !== "false" }),
		},
		CONSOLE_MONITOR_LIFECYCLE: {
			desc: "Show lifecycle events (default: true)",
			parse: (s: string) => ({ result: s !== "false" }),
		},
	};

	private verbose: boolean = false;
	private showLogEvents: boolean = true;
	private showLifecycleEvents: boolean = true;
	private lastLevel: string = "";
	private minLevel: TShownLogLevel = "info";

	cycles = {
		startExecution: () => {
			const { options, moduleOptions } = this.getWorld();
			this.verbose = getStepperOption(this, "CONSOLE_MONITOR_VERBOSE", moduleOptions) === "true";
			this.showLogEvents = getStepperOption(this, "CONSOLE_MONITOR_LOGS", moduleOptions) !== "false";
			this.showLifecycleEvents = getStepperOption(this, "CONSOLE_MONITOR_LIFECYCLE", moduleOptions) !== "false";
			this.minLevel = shownLogLevel(options);
		},

		onEvent: (event: THaibunEvent): void => {
			this.handleEvent(event);
		},
	};

	private handleEvent(event: THaibunEvent): void {
		// Determine visibility
		let visible = EventFormatter.shouldDisplay(event, this.minLevel);

		// allow verbose to override hidden start steps
		if (this.verbose && event.kind === "lifecycle" && !visible) {
			visible = true;
		}

		if (!visible) return;

		if (event.kind === "lifecycle" && !this.showLifecycleEvents) return;
		if (event.kind === "log" && !this.showLogEvents) return;

		// Handle extra newlines for structure
		if (event.kind === "lifecycle" && event.stage === "start") {
			if (event.type === "feature" || event.type === "scenario") {
				console.log("");
			}
		}

		// Format and log
		const line = EventFormatter.formatLine(event, this.lastLevel);
		this.lastLevel = EventFormatter.getDisplayLevel(event);
		console.log(line);
	}
}
