/**
 * The reads an empty state of a view leads on to, by the methods of their steps: the read of the affordances, which fills the
 * affordances panel and the domain chain, and the read of the views the site declares.
 */
import { stepMethodName } from "@haibun/core/lib/steps/domains/step-method.js";

/** The logic stepper's read of the affordances actuality offers. */
export const SHOW_AFFORDANCES_METHOD = stepMethodName("LogicStepper", "showAffordances");
/** shu's read of the views the site declares. */
export const SHOW_VIEWS_METHOD = stepMethodName("ShuStepper", "showViews");
