import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";

const { feature, scenario } = withAction(new Haibun());

export const features: TKirejiExport = {
	"Time and concurrent callers": [
		feature({ feature: "Time and concurrent callers" }),
		`Until, whenever and ensure are one predicate with three bounds: a deadline, a count and once. A service feature holds its process until a signal ends it, and two callers' proofs interleave at each call (haibun-stepper.ts:199-226, docs/reasoner.md, Where it runs).
		Accidental, and replaced by a wait on a state the system exposes: the retry interval of 200 ms (haibun-stepper.ts:60), and the loop on Date.now in place of the clock port (haibun-stepper.ts:204).`,

		scenario({ scenario: "Until passes once its statements pass within the duration" }),
		"Essential. Source: haibun-stepper.ts:199.",
		'set ready to "yes"',
		'until variable ready is "yes" within 1s',

		scenario({ scenario: "Until fails when its statements don't pass within the duration" }),
		"Essential. Source: haibun-stepper.ts:208.",
		'not until variable ready is "never" within 300ms',

		scenario({ scenario: "Two callers' proofs interleave at each call" }),
		"Essential, for RPC, MCP and a page during a service feature. Source: docs/reasoner.md, q8-replay.",
		'two callers prove "rpc ping" at once',
	],
};
