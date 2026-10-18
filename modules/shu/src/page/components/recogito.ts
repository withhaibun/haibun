/**
 * Typed access to `@recogito/text-annotator`: the W3C-compliant text annotator.
 *
 * The package's shipped `.d.ts` files use extensionless relative specifiers that this project's `node16` module
 * resolution rejects, so its own exports do not surface as types (the runtime resolves fine, esbuild bundles the
 * ES module). This one file re-declares the minimal surface the annotation display uses, so a single place holds
 * the workaround instead of every call site.
 */
// @ts-expect-error -- package ships node16-incompatible relative type specifiers; the runtime import resolves via esbuild.
import { createTextAnnotator as _createTextAnnotator, W3CTextFormat as _W3CTextFormat } from "@recogito/text-annotator";

/** The surface of the annotator this project uses: it takes annotations, shows or hides them, and reports a press on one. */
export interface TextAnnotator<E> {
	setAnnotations(annotations: E[], replace?: boolean): void;
	getAnnotations(): E[];
	setVisible(visible: boolean): void;
	on(event: "clickAnnotation", callback: (annotation: E, originalEvent: PointerEvent) => void): void;
	destroy(): void;
}

interface TextAnnotatorOptions {
	adapter?: unknown;
	annotatingEnabled?: boolean;
}

export const createTextAnnotator = _createTextAnnotator as <E>(container: HTMLElement, options?: TextAnnotatorOptions) => TextAnnotator<E>;

/** The W3C Web Annotation format adapter, anchors each annotation's TextQuoteSelector against `container` for `source`. */
export const W3CTextFormat = _W3CTextFormat as (source: string, container?: HTMLElement) => unknown;
