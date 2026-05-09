import { join } from "path";
import type { TBaseOptions } from "./world.js";
import { CAPTURE, DEFAULT_DEST } from "../schema/protocol.js";
import { TTag } from "./ttag.js";
import { containerHostPath } from "./util/node/actualURI.js";
import { slugify } from "./util/index.js";

export const captureLocator = (options: TBaseOptions, tag: TTag, ...where: (string | undefined)[]) => {
	const featn = `featn-${tag.featureNum}${tag.featureName ? `-${slugify(tag.featureName)}` : ""}`;
	const location = join(...[CAPTURE, options.DEST || DEFAULT_DEST, tag.key, featn].concat(where.filter((w) => w !== undefined)));
	const base = containerHostPath || ".";
	const loc = [base, location].join("/");
	return loc;
};
