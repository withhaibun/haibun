/**
 * A page element is defined by its own module, under its tag, when the module is imported. A page can load a module in
 * more than one of its bundles, and the first definition holds.
 */
export function defineElement(tag: string, element: CustomElementConstructor): void {
	if (!customElements.get(tag)) customElements.define(tag, element);
}
