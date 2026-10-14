/**
 * The composition root of actuality: the clock that times its events and its records, and the source of its features.
 */
import type { TClock, TFeatureSource } from "./ports.js";
import { systemClock } from "./adapters/system-clock.js";
import { nodeFeatureFiles } from "./adapters/feature-files.js";

/** The clock of actuality's events and records: this process's clock. */
export const actualityClock = (): TClock => systemClock;

/** The source of actuality's features: this process's file system. */
export const featureSource = (): TFeatureSource => nodeFeatureFiles;
