/**
 * <shu-json-tree>: a JSON value as nested disclosures, in a view that composes its markup as text. The element reads the
 * value from its text content as it connects, and renders the disclosures of `jsonTpl` in its place.
 */
import type { TemplateResult } from "lit";
import { SHU_TAG } from "../../domains/elements.js";
import { defineElement } from "../controllers/element-controller.js";
import { jsonTpl } from "./json-disclosure.js";
import { EmptyStateSchema, ShuElement, type TLinkedData } from "./shu-element.js";

class ShuJsonTree extends ShuElement<typeof EmptyStateSchema> {
	static domainSelector = SHU_TAG.JSON_TREE;
	/** The value the text content stated, read once, since the render replaces the text. */
	#value: { read: false } | { read: true; value: unknown } = { read: false };

	constructor() {
		super(EmptyStateSchema, {});
	}

	/** The disclosures render in the light DOM, so the styles of the view that holds the element apply to them. */
	protected override createRenderRoot(): HTMLElement {
		return this;
	}

	protected override onConnected(): void {
		if (this.#value.read) return;
		const text = this.textContent;
		if (text === null || text === "") throw new Error(`<${SHU_TAG.JSON_TREE}> doesn't hold the JSON text of its value. Write the value as JSON in its text.`);
		this.#value = { read: true, value: JSON.parse(text) };
		this.textContent = "";
	}

	/** The value is part of the view that holds it, which states it in its own summary. */
	summarizeForContext(): TLinkedData | null {
		return null;
	}

	render(): TemplateResult {
		if (!this.#value.read) throw new Error(`<${SHU_TAG.JSON_TREE}> renders before it read its text content`);
		return jsonTpl(this.#value.value);
	}
}

defineElement(SHU_TAG.JSON_TREE, ShuJsonTree);
