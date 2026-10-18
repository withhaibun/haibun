/**
 * Reads an artifact from actuality's artifact route with the headers of the page's delegation, and returns an object URL of
 * its content, which a view shows.
 */
export async function fetchArtifact(url: string, headers: Record<string, string>): Promise<string> {
	const response = await fetch(url, { headers, credentials: "include" });
	if (!response.ok) throw new Error(`actuality refused its artifact ${url}: ${response.status} ${await response.text()}`);
	return URL.createObjectURL(await response.blob());
}
