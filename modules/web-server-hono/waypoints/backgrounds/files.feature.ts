import type { TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";

/** The heads of the web server's waypoints, which a feature states and each waypoint below declares. */
export const files = {
	serveFrom: (loc: string) => `serve files from ${loc}`,
};

export const backgrounds: TKirejiExport = {
	"Web server files": [
		"A folder's files are served at the root of the feature's server where a feature doesn't name the route.",
		"Activity: Serve a folder's files at the root",
		'serve files at "/" from {loc}',
		`waypoint ${files.serveFrom("{loc}")}`,
	],
};
