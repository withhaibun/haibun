/**
 * Where an instance serves shu: the domain of `show shu apps` and the step's method, which the browser extension calls. The
 * page doesn't read it, so the module stays apart from the domains the page imports.
 */
import { z } from "zod";
import { CountedFields } from "@haibun/core/lib/domains/hypermedia.js";
import { stepMethodName } from "@haibun/core/lib/steps/domains/step-method.js";

/** The domain of where an instance serves shu. */
export const DOMAIN_SHU_APPS = "shu-apps";
/** Where an instance serves shu: the path of each app it mounted, which a reader opens under the instance's address, as a counted list. */
export const ShuAppsSchema = z.object({
	apps: z.array(z.object({ path: z.string() })).describe("The path of each app this instance serves shu at, under its address."),
	...CountedFields,
});
/** The step that states where an instance serves shu. */
export const SHU_APPS_METHOD = stepMethodName("ShuStepper", "showShuApps");
