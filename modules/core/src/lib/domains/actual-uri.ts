import { resolve } from "path";
import { pathToFileURL } from "url";
import type { TBaseOptions } from "../actuality/domains/world.js";

/** The base option that names the directory where a recording's container mounts the project. */
export const HOST_PROJECT_DIR = "HOST_PROJECT_DIR";

/** The address of a file a run reports: from the directory where a recording's container mounts the project, where an option names it,
 *  and otherwise from the working directory. */
export function actualURI(options: TBaseOptions, file: string) {
	return pathToFileURL(options.HOST_PROJECT_DIR === undefined ? resolve(file) : resolve(options.HOST_PROJECT_DIR, file));
}
