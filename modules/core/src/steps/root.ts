/** The composition root of core's steppers: the store of another instance's records, which the Haibun stepper mounts, and the
 *  host's speech and screen capture, which the narrator reads. */
import { RemoteQuadStore, type TRemoteQuadStoreConfig } from "../lib/transport/adapters/remote-quad-store.js";
import { speech } from "./adapters/speech.js";
import type { TSpeech } from "./ports.js";

/** The store at another instance's address, for the types `config` names. */
export const remoteQuadStore = (config: TRemoteQuadStoreConfig): RemoteQuadStore => new RemoteQuadStore(config);

/** The host's speech and screen capture. */
export const hostSpeech = (): TSpeech => speech;
