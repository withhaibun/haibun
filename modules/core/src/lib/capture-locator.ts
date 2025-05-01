import { join } from "path";
import { TBaseOptions, CAPTURE, DEFAULT_DEST } from "./defs.js";
import { TTag } from "./ttag.js";

export const captureLocator = (options: TBaseOptions, tag: TTag, ...where: (string | undefined)[]) => {
	const location = join(...[ CAPTURE, options.DEST || DEFAULT_DEST, tag.key, `seq-${tag.sequence}`, `featn-${tag.featureNum}`].concat(where.filter((w) => w !== undefined)));
	// FIXME shouldn't need ./
	return `./${location}`;
}
