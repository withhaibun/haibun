import { TBaseOptions, CAPTURE, DEFAULT_DEST } from "./defs.js";

export const captureLocator = (options: TBaseOptions, ...where: (string | undefined)[]) => {
	const base = '';
	const path = [base, CAPTURE, options.DEST || DEFAULT_DEST].concat(where.filter((w) => w !== undefined));
	return '.' + path.join('/');
}
