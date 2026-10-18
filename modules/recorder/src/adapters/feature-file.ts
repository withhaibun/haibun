/** The feature file a recording writes: its title, then each recorded step as a line. */
import { appendFile, writeFile } from "fs/promises";
import type { TFeatureFile } from "../ports.js";

export const featureFile: TFeatureFile = { start: (path, title) => writeFile(path, `${title}.\n\n`, "utf-8"), append: (path, step) => appendFile(path, `${step}\n`, "utf-8") };
