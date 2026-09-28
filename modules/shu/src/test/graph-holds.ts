/**
 * The lines that snapshot the main graph under a name and check what the snapshot records: one `snapshot the graph`
 * line, then one `variable {name}.{fact} is {value}` line per fact. A fact is a field of the snapshot's schema, so a
 * feature names a field the snapshot has and gives a value of that field's type.
 */
import { withAction, type TKirejiStep } from "@haibun/core/kireji/withAction.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import ShuPolymorphicGraphViewControls, { type TGraphSnapshot } from "../components/shu-polymorphic-graph-view.controls.js";

const { snapshotGraph } = withAction(new ShuPolymorphicGraphViewControls());
const { setFromStatement, is } = withAction(new VariablesStepper());

/** The facts a check compares: the snapshot's fields other than its framing, which the checks since a snapshot compare. */
type TGraphFacts = Omit<TGraphSnapshot, "camera" | "viewport" | "pos">;

/** A value as `is` reads it: a list as its JSON, and every other value quoted as its text. */
const asLiteral = (value: unknown): string => (Array.isArray(value) ? JSON.stringify(value) : `"${String(value)}"`);

/** Snapshot the graph as `name`, and check that it holds each of `facts`. */
export const graphHolds = (name: string, facts: Partial<TGraphFacts>): TKirejiStep[] => [
	setFromStatement({ what: `"${name}"`, statement: snapshotGraph({}) }),
	...Object.entries(facts).map(([fact, value]) => is({ what: `${name}.${fact}`, value: asLiteral(value) })),
];
