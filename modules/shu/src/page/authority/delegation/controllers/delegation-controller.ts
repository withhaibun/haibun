/** The delegations the page gives, as the ask and the browser extension's panel sign them (`pipelines/delegate.ts`). */
import { authorityScope } from "../../root.js";
import { pageDelegationSigner } from "../root.js";
import { delegateFromPage as delegateIn, type TDelegationTo } from "../pipelines/delegate.js";

/** Signs a delegation the page gives from one it holds. */
export const delegateFromPage = (to: TDelegationTo): Promise<Record<string, unknown>> => delegateIn(authorityScope(), pageDelegationSigner(), to);
