/** Reads a link from a representation's `_links`. */
import type { TLink, TRepresentation } from "../domains/links.js";

/** Whether `rep._links` holds a well-formed link under `rel`. A view tests it before `getLink` where the link is optional. */
export function hasLink(rep: TRepresentation, rel: string): boolean {
	const link = rep._links?.[rel];
	return !!link && typeof link === "object" && typeof link.method === "string";
}

/** Returns the link under `rel`. Throws where `rep` doesn't hold `_links` or a well-formed link under `rel`, and names the
 *  links it holds. */
export function getLink(rep: TRepresentation, rel: string): TLink {
	const links = rep._links;
	if (!links || typeof links !== "object") throw new Error(`getLink("${rel}"): the ${String(rep._type)} representation doesn't hold _links`);
	const link = links[rel];
	if (!link || typeof link !== "object" || typeof link.method !== "string") throw new Error(`getLink("${rel}"): _links doesn't hold ${rel}; it holds ${Object.keys(links).join(", ")}`);
	return link;
}
