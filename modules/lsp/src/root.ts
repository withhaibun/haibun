/** The language server's composition root: the editor's connection over the process's standard input and output, the workspaces on disk, and the clock. */
import { stdioConnection } from "./adapters/connection.js";
import { systemClock } from "./adapters/clock.js";
import { diskWorkspaces } from "./adapters/workspaces.js";
import type { TLspPorts } from "./ports.js";

export const lspPorts = (): TLspPorts => ({ connection: stdioConnection(), workspaces: diskWorkspaces, clock: systemClock });
