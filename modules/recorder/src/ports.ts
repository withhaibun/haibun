/** The ports of a recording: the page whose interactions it captures, the feature file it writes, the clock and the log. */
import type { Page } from "playwright";
import type { TClock } from "@haibun/core/lib/actuality/ports.js";
import type { TInteraction } from "./domains/interaction.js";

/** Captures a page's interactions, each passed to `onInteraction`. */
export type TPageRecorder = { instrument(page: Page, onInteraction: (interaction: TInteraction) => void): Promise<void> };

/** The feature file a recording writes at `path`: its title, then each step as a line. */
export type TFeatureFile = { start(path: string, title: string): Promise<void>; append(path: string, step: string): Promise<void> };

/** The log of what a recording captured and of a write that failed. */
export type TRecordingLog = { info(message: string): void; error(message: string): void };

export type TRecordingPorts = { pages: TPageRecorder; file: TFeatureFile; clock: TClock; log: TRecordingLog };
