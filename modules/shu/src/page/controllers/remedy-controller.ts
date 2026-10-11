/** The remedies a refusal's control performs through the page's remedies port. */
import { pageRemedies } from "../root.js";
import type { TRemedy } from "@haibun/core/lib/rpc-wire.js";

/** Performs a reload remedy. The page reads the client, actuality and the reader's authority again as it starts, so each
 *  reload reloads the page. */
export const reloadFor = (_what: Extract<TRemedy, { do: "reload" }>["what"]): void => pageRemedies().reloadPage();
