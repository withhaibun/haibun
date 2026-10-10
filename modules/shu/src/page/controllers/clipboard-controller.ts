/** Copies text to the page's clipboard, for a view's copy control. */
import { pageClipboard } from "../root.js";

/** Copies `text` to the page's clipboard, and returns whether the clipboard holds it. */
export const copyText = (text: string): Promise<boolean> => pageClipboard().copy(text);
