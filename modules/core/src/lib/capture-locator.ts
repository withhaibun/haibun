import { join } from "path";
import { TBaseOptions, CAPTURE, DEFAULT_DEST } from "./defs.js";
import { TTag } from "./ttag.js";
import { containerHostPath } from "./util/actualURI.js";

export const captureLocator = (options: TBaseOptions, tag: TTag, ...where: (string | undefined)[]) => {
	const location = join(...[CAPTURE, options.DEST || DEFAULT_DEST, tag.key, `seq-${tag.sequence}`, `featn-${tag.featureNum}`].concat(where.filter((w) => w !== undefined)));
	const base = containerHostPath || '.';
	const loc = [base, location].join('/');
	return loc;
}
