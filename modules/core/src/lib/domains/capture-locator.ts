import { join } from "path";
import type { TBaseOptions } from "../actuality/domains/world.js";
import { CAPTURE } from "./protocol.js";
import { TTag } from "./ttag.js";
import { slugify } from "./util.js";

export const captureLocator = (options: TBaseOptions, tag: TTag, ...where: (string | undefined)[]) => {
	const featn = `featn-${tag.featureNum}${tag.featureName ? `-${slugify(tag.featureName)}` : ""}`;
	const location = join(...[CAPTURE, options.DEST, tag.key, featn].concat(where.filter((w) => w !== undefined)));
	const base = options.HOST_PROJECT_DIR === undefined ? "." : options.HOST_PROJECT_DIR;
	const loc = [base, location].join("/");
	return loc;
};
