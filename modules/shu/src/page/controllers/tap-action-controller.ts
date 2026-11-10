/** Controls the primed tap action machine and its signals for views. */
import { pageClipboard, pageTapAction } from "../root.js";
import { TAP_ACTION_EVENT, type TTapActionEvent, type TTapActionState } from "../machines/tap-action.js";
import type { Machine } from "@haibun/core/lib/machines/machine.js";

export { TAP_ACTION_EVENT, type TTapActionEvent, type TTapActionState };

export const getPageTapAction = (): Machine<TTapActionState, TTapActionEvent> => pageTapAction();

export const copyToPageClipboard = (text: string): Promise<boolean> => pageClipboard().copy(text);
export const getPageClipboard = () => pageClipboard();
