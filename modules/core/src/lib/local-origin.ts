/** The origin a process on this machine serves at `port`: where a run reaches an instance it started, a web server it
 *  runs, or whatever holds a port it probes. */
export const localOrigin = (port: number): string => `http://localhost:${port}`;
