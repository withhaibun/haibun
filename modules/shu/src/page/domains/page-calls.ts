/**
 * The steps the page calls on channels of its own, each with the action it requires, which the page states before it reads
 * actuality's steps. A page reports a diagnostic and sends its occurrences from its start, a reload among them, and a call's
 * proof signs under the action the page states for its method, so such a call is signed once the page holds its key and its
 * delegations, whether or not the page has read actuality's steps (TX20).
 */
import { Access } from "@haibun/core/lib/resources.js";
import { readAction, requiredAction } from "@haibun/core/lib/actions.js";
import { stepMethodName } from "@haibun/core/lib/steps/domains/step-method.js";
import { SHOW_STEPS_ACTION, SHOW_STEPS_METHOD } from "@haibun/core/lib/step-discovery.js";

/** The monitor's step that takes a page's diagnostic. */
export const CLIENT_LOG = { stepper: "MonitorStepper", step: "logClient" } as const;
export const CLIENT_LOG_METHOD = stepMethodName(CLIENT_LOG.stepper, CLIENT_LOG.step);
/** The action that reporting a diagnostic to actuality requires. A page is delegated this action with its other actions. */
export const CLIENT_LOG_ACTION = requiredAction(CLIENT_LOG.stepper, CLIENT_LOG.step, {});

/** The monitor's step that takes a page's batch of occurrences, a read at the private level. */
export const RECORD_BLIPS = { stepper: "MonitorStepper", step: "recordClientBlips" } as const;
export const RECORD_BLIPS_METHOD = stepMethodName(RECORD_BLIPS.stepper, RECORD_BLIPS.step);
export const RECORD_BLIPS_ACTION = readAction(Access.private);

/** The action each of the page's own calls requires, by its method: discovery's, the diagnostic's and the occurrences'. */
export const PAGE_CALL_ACTIONS: Readonly<Record<string, string>> = {
	[SHOW_STEPS_METHOD]: SHOW_STEPS_ACTION,
	[CLIENT_LOG_METHOD]: CLIENT_LOG_ACTION,
	[RECORD_BLIPS_METHOD]: RECORD_BLIPS_ACTION,
};
