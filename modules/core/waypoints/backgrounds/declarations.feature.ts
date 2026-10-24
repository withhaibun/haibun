import type { TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import { SHOW_STEPS_LINE } from "@haibun/core/lib/step-discovery.js";

/** The heads of core's waypoints, which a feature states and each waypoint below declares. */
export const declarations = {
	shows: "show shows",
};

export const backgrounds: TKirejiExport = {
	"Actuality's declarations": [
		"What actuality declares, read through its steps' own reads and the list combinators.",
		"Activity: List the steps that show something",
		`ordered by "pattern", matching "show ", ${SHOW_STEPS_LINE}`,
		`waypoint ${declarations.shows}`,
	],
};
