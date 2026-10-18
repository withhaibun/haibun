/** The recorder's composition root: the page recorder, the feature file and actuality's clock. */
import { actualityClock } from "@haibun/core/lib/actuality/root.js";
import { featureFile } from "./adapters/feature-file.js";
import { pageRecorder } from "./adapters/page-recorder.js";
import type { TRecordingLog, TRecordingPorts } from "./ports.js";

/** The ports of a recording that logs to `log`. */
export const recordingPorts = (log: TRecordingLog): TRecordingPorts => ({ pages: pageRecorder, file: featureFile, clock: actualityClock(), log });
