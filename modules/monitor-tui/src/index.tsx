/**
 * TuiMonitorStepper - Terminal UI monitor using onEvent cycle.
 */

import React, { useState } from "react";
import { render, Text, Box, Static, useInput } from "ink";
import { AStepper, IHasCycles, StepperKinds, TStartFeature } from "@haibun/core/lib/astepper.js";
import { TWorld } from "@haibun/core/lib/world.js";
import type { THaibunEvent } from "@haibun/core/schema/protocol.js";
import { EventFormatter, THaibunLogLevel } from "@haibun/core/monitor/index.js";
import { IPrompter, TPrompt, TPromptResponse } from "@haibun/core/lib/prompter.js";

const EventLine = ({ line }: { line: string }) => <Text>{line}</Text>;

const RunningPanel = ({ steps, finished, featurePath }: { steps: Map<string, string>; finished: boolean; featurePath: string }) => (
	<Box flexDirection="column" marginTop={1}>
		<Text bold>Haibun Monitor: {featurePath}</Text>
		<Text underline>Running Steps:</Text>
		{Array.from(steps.entries()).map(([id, label]) => (
			<Text key={id} color="yellow">
				⏳ {label}
			</Text>
		))}
		{!finished && steps.size === 0 && <Text color="gray">No active steps</Text>}
		{finished && (
			<Text color="blue" bold>
				Finished
			</Text>
		)}
	</Box>
);

const TextInput = ({ onSubmit }: { onSubmit: (val: string) => void }) => {
	const [value, setValue] = useState("");

	useInput((input, key) => {
		if (key.return) {
			onSubmit(value);
			setValue("");
		} else if (key.backspace || key.delete) {
			setValue((v) => v.slice(0, -1));
		} else if (!key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
			// Simple toggle to filter out control sequences that might corrupt the buffer
			// Only accepting printable characters roughly
			setValue((v) => v + input);
		}
	});

	return <Text>➜ {value}_</Text>;
};

const PromptView = ({ prompt, resolve }: { prompt: TPrompt; resolve: (val: string) => void }) => {
	return (
		<Box flexDirection="column" marginTop={1}>
			<Text color="cyan">{prompt.message}</Text>
			<Text color="gray">({prompt.options?.join(", ")})</Text>
			<TextInput onSubmit={resolve} />
		</Box>
	);
};

const MonitorApp = ({
	lines,
	running,
	finished,
	prompt,
	featurePath,
	onResolve,
}: {
	lines: string[];
	running: Map<string, string>;
	finished: boolean;
	featurePath: string;
	prompt?: TPrompt;
	onResolve?: (val: string) => void;
}) => (
	<Box flexDirection="column">
		<Static items={lines}>{(line, i) => <EventLine key={i} line={line} />}</Static>
		<RunningPanel steps={running} finished={finished} featurePath={featurePath} />
		{prompt && onResolve && <PromptView prompt={prompt} resolve={onResolve} />}
	</Box>
);

export default class TuiMonitorStepper extends AStepper implements IHasCycles, IPrompter {
	kind = StepperKinds.MONITOR;
	steps = {};

	private lines: string[] = [];
	private lastLevel: string = "";
	private running = new Map<string, string>();
	private finished = false;
	private currentPrompt?: TPrompt;
	private rerender: ((lines: string[], running: Map<string, string>, finished: boolean, prompt?: TPrompt) => void) | null = null;
	private promptResolver: ((value: TPromptResponse) => void) | null = null;
	private promptRejecter: ((reason?: unknown) => void) | null = null;
	featurePath: string;

	/** Whether there is a terminal to draw on. Piped into a file, a screen redrawn per event is escape codes between
	 *  the lines and a React render per step; the lines alone are what a file wants, printed as the console monitor
	 *  prints them. */
	private readonly terminal = process.stdout.isTTY === true;

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		world.prompter.subscribe(this);
		world.eventLogger.suppressConsole = true;
	}

	async prompt(prompt: TPrompt): Promise<TPromptResponse> {
		this.currentPrompt = prompt;
		this.updateRender();
		return new Promise((resolve, reject) => {
			this.promptResolver = resolve;
			this.promptRejecter = reject;
		});
	}

	cancel(id: string) {
		if (this.currentPrompt?.id === id) {
			if (this.promptRejecter) {
				this.promptRejecter(new Error("Cancelled"));
			}
			this.currentPrompt = undefined;
			this.promptResolver = null;
			this.promptRejecter = null;
			this.updateRender();
		}
	}

	resolve(id: string, value: TPromptResponse) {
		if (this.currentPrompt?.id === id && this.promptResolver) {
			this.promptResolver(value);
			this.currentPrompt = undefined;
			this.promptResolver = null;
			this.promptRejecter = null;
			this.updateRender();
		}
	}

	private updateRender() {
		if (this.rerender) {
			this.rerender(this.lines, this.running, this.finished, this.currentPrompt);
		}
	}

	cycles = {
		startExecution: async () => {
			if (!this.terminal) return;
			const onResolve = (val: string) => {
				if (this.promptResolver) {
					this.promptResolver(val);
					this.currentPrompt = undefined;
					this.promptResolver = null;
					this.promptRejecter = null;
					this.updateRender();
				}
			};
			const { rerender } = render(<MonitorApp featurePath={this.featurePath} lines={[]} running={new Map()} finished={false} />);

			this.rerender = (lines, running, finished, prompt) =>
				rerender(<MonitorApp featurePath={this.featurePath} lines={lines} running={running} finished={finished} prompt={prompt} onResolve={onResolve} />);
		},
		startFeature: ({ resolvedFeature }: TStartFeature) => {
			this.featurePath = resolvedFeature.path;
		},

		onEvent: (event: THaibunEvent): void => {
			const minLevel = (process.env.HAIBUN_LOG_LEVEL as unknown as THaibunLogLevel) || "info";
			if (EventFormatter.shouldDisplay(event, minLevel)) {
				const line = EventFormatter.formatLine(event, this.lastLevel);
				this.lastLevel = EventFormatter.getDisplayLevel(event);
				if (!this.terminal) {
					console.log(line);
					return;
				}
				this.lines = [...this.lines, line];
			}
			if (!this.terminal) return;

			if (event.kind === "lifecycle" && event.type === "step") {
				if (event.stage === "start") {
					this.running = new Map(this.running).set(event.id, event.in || "");
				} else if (event.stage === "end") {
					this.running = new Map(this.running);
					this.running.delete(event.id);
				}
			}

			this.updateRender();
		},

		endExecution: async () => {
			this.finished = true;
			this.updateRender();
		},
	};
}
