import type { TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";

/** The heads of shu's waypoints over the registered domains, which a feature states and each waypoint below declares. */
export const domains = {
	hold: (key: string) => `the domains hold ${key}`,
	viewOf: (key: string, component: string) => `domain ${key} is a view drawn by ${component}`,
};

export const backgrounds: TKirejiExport = {
	Domains: [
		"The registered domains, each a Domain record the declarations derive: its key, what it holds, its values where it is a set, and the component that draws it where it is a view.",
		"Activity: Read a domain's record",
		"set shu domain from get individual Domain {key} with edges",
		"variable shu domain.vertex.name is {key}",
		`waypoint ${domains.hold("{key}")}`,
		"A domain that names the component drawing it is a view, which the views picker lists.",
		"Activity: Read a view's domain",
		"set shu view from get individual Domain {key} with edges",
		"variable shu view.vertex.component is {component}",
		`waypoint ${domains.viewOf("{key}", "{component}")}`,
	],
};
