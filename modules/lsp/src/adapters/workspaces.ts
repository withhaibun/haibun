/** The workspaces on disk, as core's workspace discovery reads them. */
import { countFeatures, findHaibunWorkspace, loadBackgroundsFromPath } from "@haibun/core/lib/workspace-discovery.js";
import type { TWorkspaces } from "../ports.js";

export const diskWorkspaces: TWorkspaces = {
	find: (path) => findHaibunWorkspace(path) ?? undefined,
	backgrounds: (backgroundsPath) => loadBackgroundsFromPath(backgroundsPath),
	countFeatures: (base) => countFeatures(base),
};
