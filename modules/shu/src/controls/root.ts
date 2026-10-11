/** The controls' composition root: the page each control drives. */
import { controlledPage } from "./adapters/controlled-page.js";
import type { AStepper } from "@haibun/core/lib/astepper.js";
import type { TControlledPage } from "./ports.js";

/** The page `stepper`'s world drives. */
export const controlled = (stepper: AStepper): TControlledPage => controlledPage(stepper);
