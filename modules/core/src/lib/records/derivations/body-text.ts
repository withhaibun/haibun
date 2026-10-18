/**
 * The text of a Body that a search indexes, and the text a reader sends where it forwards a record's text. A form converted
 * from another can drop text, such as an image's alternative text, a link's target, a table's cells or a hidden part, so each
 * form can hold words the others don't. The index holds the text of every form. The maximal text holds the Body's text, then
 * each line of another form that holds a word the text before it doesn't.
 */
import { defaultTreeAdapter, parse, type DefaultTreeAdapterMap } from "parse5";
import { MEDIA_TYPE } from "../../domains/media-types.js";
import type { TRepresentation } from "../../domains/resources.js";
import type { TBodyText } from "../domains/body.js";
import { BODY_PREFERENCE } from "./bodies.js";

type THtmlNode = DefaultTreeAdapterMap["node"];
type THtmlElement = DefaultTreeAdapterMap["element"];
type THtmlTemplate = DefaultTreeAdapterMap["template"];

/** The elements whose content a page doesn't render as text: a script and a style sheet. */
const NOT_TEXT = new Set(["script", "style"]);

/** The elements a page renders within a line of text. Every other element ends the line before it and the line it holds. */
const INLINE = new Set([
	...["a", "abbr", "b", "bdi", "bdo", "cite", "code", "data", "del", "dfn", "em", "font", "i", "img", "ins", "kbd", "label", "mark", "q", "s", "samp", "small"],
	...["span", "strike", "strong", "sub", "sup", "time", "tt", "u", "var", "wbr"],
]);

/** The attributes whose value is text an element shows in place of its content, or the target a link reaches. */
const TEXT_ATTRIBUTES = new Set(["alt", "title", "aria-label", "href"]);

/** The text between two forms in a Body's index, and between a Body's text and the lines another form adds to it. */
const FORM_SEPARATOR = "\n\n";

/** Returns the words of a text: its runs of letters and digits. */
export const termWords = (text: string): string[] => text.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 0);

/** Returns the words of a text as a comparison of words reads them, in lower case. */
const comparedWords = (text: string): string[] => termWords(text).map((word) => word.toLowerCase());

const isTemplate = (element: THtmlElement): element is THtmlTemplate => "content" in element;

/**
 * Returns the text of an HTML document: each line of the text it renders, then the value of each attribute of
 * `TEXT_ATTRIBUTES` once, on a line of its own, such as an image's alternative text and a link's target. Text the page hides,
 * such as an element styled `display: none`, is text the document holds, and is returned. A script and a style sheet aren't.
 */
export function htmlText(html: string): string {
	const lines: string[] = [];
	const attributes = new Set<string>();
	let line = "";
	const endLine = (): void => {
		const text = line.replace(/\s+/g, " ").trim();
		if (text.length > 0) lines.push(text);
		line = "";
	};
	const visitElement = (element: THtmlElement): void => {
		const tag = defaultTreeAdapter.getTagName(element);
		if (NOT_TEXT.has(tag)) return;
		for (const { name, value } of defaultTreeAdapter.getAttrList(element)) if (TEXT_ATTRIBUTES.has(name) && value.trim().length > 0) attributes.add(value.trim());
		const block = !INLINE.has(tag);
		if (block) endLine();
		(isTemplate(element) ? defaultTreeAdapter.getTemplateContent(element).childNodes : defaultTreeAdapter.getChildNodes(element)).forEach(visit);
		if (block) endLine();
	};
	const visit = (node: THtmlNode): void => {
		if (defaultTreeAdapter.isTextNode(node)) line += defaultTreeAdapter.getTextNodeContent(node);
		else if (defaultTreeAdapter.isElementNode(node)) visitElement(node);
		else if ("childNodes" in node) node.childNodes.forEach(visit);
	};
	visit(parse(html));
	endLine();
	return [...lines, ...attributes].join("\n");
}

/** Returns the text of a form as a reader reads its words: an HTML form's `htmlText`, and another form's text as it is. */
export const textOfForm = ({ mediaType, content }: TRepresentation): string => (mediaType === MEDIA_TYPE.html ? htmlText(content) : content);

/** Returns the rank of a media type in `BODY_PREFERENCE`. A media type it doesn't order ranks after every one it does. */
const preferenceRank = (mediaType: string): number => (BODY_PREFERENCE.includes(mediaType) ? BODY_PREFERENCE.indexOf(mediaType) : BODY_PREFERENCE.length);

/** Returns a Body's representations in the order of `BODY_PREFERENCE`. */
const representationsOf = (body: TBodyText): TRepresentation[] =>
	body.representations === undefined ? [] : [...body.representations].sort((a, b) => preferenceRank(a.mediaType) - preferenceRank(b.mediaType));

/**
 * Returns the text a search indexes for a Body: the text of each of its forms by `textOfForm`, its text first, so a word that
 * any form holds finds the record. The text of a Body of several forms is markdown or plain text, since `BODY_PREFERENCE`
 * orders HTML last, so the index of such a Body holds more than its text.
 */
export const indexedText = (body: TBodyText): string => [body, ...representationsOf(body)].map(textOfForm).join(FORM_SEPARATOR);

/**
 * Returns a Body's maximal text: its text, then each line of the text of each representation by `textOfForm` that holds a
 * word the text before the line doesn't. The result holds every word of every form, and a line of another form that holds
 * only words the result holds isn't repeated. The text of a Body of several forms is markdown or plain text, so a line of
 * plain text added to it reads in the Body's media type. A Body of one form returns its text.
 */
export function maximalText(body: TBodyText): string {
	const held = new Set(comparedWords(textOfForm(body)));
	const added: string[] = [];
	for (const line of representationsOf(body).flatMap((form) => textOfForm(form).split("\n"))) {
		const words = comparedWords(line);
		if (words.every((word) => held.has(word))) continue;
		added.push(line.trim());
		for (const word of words) held.add(word);
	}
	return added.length === 0 ? body.content : `${body.content}${FORM_SEPARATOR}${added.join("\n")}`;
}
