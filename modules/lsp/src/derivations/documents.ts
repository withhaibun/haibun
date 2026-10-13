/** What the language server reads of a document's address and text: its path, whether it is kireji, and whether it is a background. */
import { KIREJI_TYPE_NAMES } from "../domains/lsp.js";

const FILE_SCHEME = "file://";
/** The directory a background file is in, as the activities stepper reads it. */
const BACKGROUNDS_DIRECTORY = "/backgrounds/";
const TYPESCRIPT_LANGUAGES = new Set(["typescript", "typescriptreact"]);
const TYPESCRIPT_EXTENSION = ".ts";

/** A document's path from its address: without the file scheme, and decoded. */
export function pathOf(uriOrPath: string): string {
	return decodeURIComponent(uriOrPath.startsWith(FILE_SCHEME) ? uriOrPath.slice(FILE_SCHEME.length) : uriOrPath);
}

/** Whether a text names a kireji type, which marks a TypeScript document as a feature. */
export const namesKirejiType = (text: string): boolean => KIREJI_TYPE_NAMES.some((name) => text.includes(name));

/** Whether a document is TypeScript: by its language, its extension, or a kireji type its text names. */
export const isTypeScript = (languageId: string, path: string, text: string): boolean =>
	TYPESCRIPT_LANGUAGES.has(languageId) || path.toLowerCase().endsWith(TYPESCRIPT_EXTENSION) || namesKirejiType(text);

/** Whether a path is a background file's: one in a backgrounds directory. */
export const isBackgroundPath = (path: string): boolean => path.includes(BACKGROUNDS_DIRECTORY);

/** Whether two paths name one file, where either may be a suffix of the other, as a background's path read from a run's base is. */
export const samePath = (one: string, other: string): boolean => one === other || one.endsWith(other) || other.endsWith(one);

/** A background's name: its file's name. */
export function fileNameOf(path: string): string {
	const name = path.split("/").at(-1);
	if (name === undefined || name === "") throw new Error(`the background path "${path}" ends with a separator, so it doesn't name a file`);
	return name;
}
