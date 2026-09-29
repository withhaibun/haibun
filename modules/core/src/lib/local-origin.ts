/** The origin a process on this machine serves at `port`: where a run reaches an instance it started, a web server it
 *  runs, or whatever holds a port it probes. */
export const localOrigin = (port: number): string => `http://localhost:${port}`;

/** A URL without its trailing slashes, so a path appended to it has one slash. */
export const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, "");
