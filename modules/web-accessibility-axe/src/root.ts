/** The accessibility check's composition root: axe run in the browser's page, and actuality's clock. */
import { actualityClock } from "@haibun/core/lib/actuality/root.js";
import type { TDiscourseStore } from "@haibun/core/lib/domains/resources.js";
import { axeBrowser } from "./adapters/axe.js";
import type { TAxe, TEarlPorts } from "./ports.js";

/** The ports of a check that writes its assertions to `store`. */
export const axePorts = (store: TDiscourseStore): TEarlPorts & { axe: TAxe } => ({ store, clock: actualityClock(), axe: axeBrowser });
