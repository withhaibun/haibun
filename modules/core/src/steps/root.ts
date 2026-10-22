/** The composition root of core's steppers: the store of another instance's records, which the Haibun stepper mounts, the
 *  host's speech and screen capture, which the narrator reads, and the package that holds a file, which names a waypoint's
 *  library. */
import { RemoteQuadStore, type TRemoteQuadStoreConfig } from "../lib/transport/adapters/remote-quad-store.js";
import { packageNameOf } from "../lib/adapters/workspace-lib.js";
import { speech } from "./adapters/speech.js";
import type { TSpeech } from "./ports.js";

/** The store at another instance's address, for the types `config` names. */
export const remoteQuadStore = (config: TRemoteQuadStoreConfig): RemoteQuadStore => new RemoteQuadStore(config);

/** The host's speech and screen capture. */
export const hostSpeech = (): TSpeech => speech;

/** The name of the package that holds the file at `path`, or undefined where a package doesn't hold it. */
export const packageOf = (path: string): string | undefined => packageNameOf(path);
