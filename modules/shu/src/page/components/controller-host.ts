/**
 * A controller's host element. It holds controllers, renders into its root, and holds the elements the controller's own
 * template rendered.
 */
import type { ReactiveControllerHost } from "lit";

export type TControllerHost = ReactiveControllerHost & HTMLElement & { readonly renderRoot: ParentNode };
