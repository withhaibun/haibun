/**
 * The element a controller of a component's subsystem is held by: it holds controllers, renders into its root, and is
 * where the controller finds the elements its own template rendered.
 */
import type { ReactiveControllerHost } from "lit";

export type TControllerHost = ReactiveControllerHost & HTMLElement & { readonly renderRoot: ParentNode };
