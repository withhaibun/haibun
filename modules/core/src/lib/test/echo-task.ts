/** A task of the worker pool for its tests: it requests an effect of its process with its input, and returns the reply doubled. */
import { z } from "zod";
import { runTask } from "@haibun/core/lib/workers/adapters/run-task.js";

export default runTask(z.object({ text: z.string() }), async ({ text }, effect) => ({ doubled: `${String(await effect(text))}${String(await effect(text))}` }));
