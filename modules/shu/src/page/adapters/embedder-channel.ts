/** The channel between shu's frame and the window that embeds it, at the origin the deployment names. */
import type { TEmbedderChannel } from "../ports.js";

/** The part of a frame's window that receives messages and references the embedding window (`parent`). */
export type TFrameWindow = Pick<Window, "parent" | "addEventListener" | "removeEventListener">;

/** Returns the channel of `frame` to its embedding window at `origin`. A message from another window isn't addressed to shu,
 *  and the channel passes over it. */
export function embedderChannel(frame: TFrameWindow, origin: string): TEmbedderChannel {
	return {
		receive: (fn, refused) => {
			const onMessage = (e: MessageEvent): void => {
				if (e.source !== frame.parent) return;
				if (e.origin !== origin) return refused(e.origin);
				fn(e.data);
			};
			frame.addEventListener("message", onMessage as EventListener);
			return () => frame.removeEventListener("message", onMessage as EventListener);
		},
		post: (message) => frame.parent.postMessage(message, origin),
	};
}
