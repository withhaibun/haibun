/** Runtime key set when a feature reaches `this feature runs as a service until stopped`: everything the feature set up
 *  has run, and the instance is serving. A caller waiting only for the port would race with the rest of the feature. */
export const SERVING = "serving";
