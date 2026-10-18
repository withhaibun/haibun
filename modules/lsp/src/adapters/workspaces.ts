/** The workspaces on disk, as core's workspace discovery reads them. */
import nodeFS from "fs";
import { countFeatures, findHaibunWorkspace, loadBackgroundsFromPath } from "@haibun/core/lib/adapters/workspace-discovery.js";
import type { TWorkspaces } from "../ports.js";

export const diskWorkspaces: TWorkspaces = {
	find: (path) => findHaibunWorkspace(path, nodeFS) ?? undefined,
	backgrounds: (backgroundsPath) => loadBackgroundsFromPath(backgroundsPath, nodeFS),
	countFeatures: (base) => countFeatures(base, nodeFS),
};
