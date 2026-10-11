/** Writes a report to a path on disk. */
import { writeFileSync } from "node:fs";
import type { TReportFile } from "../ports.js";

export const reportFile = (): TReportFile => ({ write: (path, html) => writeFileSync(path, html) });
