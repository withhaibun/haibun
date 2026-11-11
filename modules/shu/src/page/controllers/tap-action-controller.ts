/** Controls the tap action machine and its signals for views, and the copy a tap applies. */
import { pageTapAction } from "../root.js";
import { copyText } from "./clipboard-controller.js";
import { COPY_RESULT, TAP_ACTION_EVENT, type TCopyResult, type TTapActionEvent, type TTapActionState } from "../machines/tap-action.js";
import type { Machine } from "@haibun/core/lib/machines/machine.js";

export { COPY_RESULT, TAP_ACTION_EVENT, type TCopyResult, type TTapActionEvent, type TTapActionState };

export const getPageTapAction = (): Machine<TTapActionState, TTapActionEvent> => pageTapAction();

/** Copies `text` to the page's clipboard, and states what the copy did on the tap action machine. */
export const copyToClipboard = (text: string | null): void => {
	const copied = (result: TCopyResult) => getPageTapAction().dispatch({ type: TAP_ACTION_EVENT.COPIED, copied: result });
	if (text === null || text === "") return void copied(COPY_RESULT.empty);
	void copyText(text).then((held) => copied(held ? COPY_RESULT.copied : COPY_RESULT.refused));
};
