/** The page the world's web-playwright drives, which a control reads and drives. */
import type WebPlaywright from "@haibun/web-playwright";
import { WEB_PLAYWRIGHT } from "@haibun/web-playwright/actions.js";
import type { AStepper } from "@haibun/core/lib/steps/domains/stepper.js";
import { runSteppers } from "@haibun/core/lib/actuality/domains/world.js";
import { findStepper } from "@haibun/core/lib/domains/util.js";
import type { TControlledPage } from "../ports.js";

/** The world's web-playwright. A world that doesn't hold it is refused with the steppers it holds. */
const controlledBrowser = (stepper: AStepper): WebPlaywright => findStepper<WebPlaywright>(runSteppers(stepper.getWorld()), WEB_PLAYWRIGHT);

/** The page `stepper`'s world drives through web-playwright. */
export const controlledPage = (stepper: AStepper): TControlledPage => ({ page: () => controlledBrowser(stepper).getPage(), storage: () => controlledBrowser(stepper).storage });
