/**
 * The shapes of the elements the page drives by what they offer. A page loads more than one bundle, and each bundle defines its own
 * copy of a class, so an element another bundle defined isn't an instance of this bundle's class. A guard checks the methods and
 * fields the page calls instead.
 */
import type { TGraphPresenter, TPaneElement } from "../ports.js";

/** Whether `value` holds a function under each of `methods`. */
const holdsMethods = (value: unknown, methods: readonly string[]): boolean =>
	typeof value === "object" && value !== null && methods.every((method) => typeof Reflect.get(value, method) === "function");

/** The methods a graph presenter offers its host. */
const PRESENTER_METHODS = ["setQuads", "selectNode", "previewNodes", "summarizeForContext"] as const;
/** The methods a pane offers the strip. */
const PANE_METHODS = ["setMinimized", "setMaximized", "setDocked", "setPinned", "close"] as const;

/** Whether an element is a graph presenter: an element that offers each method a host calls. */
export const isGraphPresenter = (element: Element): element is TGraphPresenter => element instanceof HTMLElement && holdsMethods(element, PRESENTER_METHODS);

/** Whether an element is a pane: an element that states whether it is docked and offers each method the strip calls. */
export const isPaneElement = (element: Element): element is TPaneElement =>
	element instanceof HTMLElement && typeof Reflect.get(element, "docked") === "boolean" && holdsMethods(element, PANE_METHODS);
