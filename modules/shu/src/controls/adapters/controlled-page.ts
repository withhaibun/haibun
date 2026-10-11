/** The page the world's web-playwright drives, which a control reads and drives. */
import WebPlaywright from "@haibun/web-playwright";
import type { AStepper } from "@haibun/core/lib/astepper.js";
import type { TControlledPage } from "../ports.js";

/** The world's web-playwright, or a refusal naming the control whose world doesn't hold it. */
function controlledBrowser(stepper: AStepper): WebPlaywright {
	const wp = stepper.getWorld().runtime.steppers?.find((s) => s instanceof WebPlaywright) as WebPlaywright | undefined;
	if (!wp) throw new Error(`${stepper.constructor.name}: the world doesn't hold WebPlaywright`);
	return wp;
}

/** The page `stepper`'s world drives through web-playwright. */
export const controlledPage = (stepper: AStepper): TControlledPage => ({ page: () => controlledBrowser(stepper).getPage(), storage: () => controlledBrowser(stepper).storage });
