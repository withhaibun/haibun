import { findHandlers } from "@haibun/core/build/lib/util/index.js";
import { IHandleResultHistory, HANDLE_RESULT_HISTORY } from "./domain-storage.js";
import { EMediaTypes } from "./media-types.js";
import { TEndFeatureCallback, TEndFeatureCallbackParams, TOptions, TWorld } from "@haibun/core/build/lib/defs.js";
import { Timer } from "@haibun/core/build/lib/Timer.js";
import Logger from "@haibun/core/build/lib/Logger.js";

export const getHandlerFeatureCallback = (world: TWorld, description = ''): TEndFeatureCallback | undefined => {
  if (!world.options.TRACE) {
    console.log('no trace', world.options)
    return undefined;
  }
  return async (params: TEndFeatureCallbackParams) => {
    const { world, result, steppers, startOffset } = params;
    const historyHandlers = findHandlers<IHandleResultHistory>(steppers, HANDLE_RESULT_HISTORY);
    const loc = { ...world };
    const traceHistory = [...Logger.traceHistory];
    for (const h of historyHandlers) {
      world.logger.debug(`trace history for ${h.constructor.name}`);
      await h.handle({ ...loc, mediaType: EMediaTypes.json }, description, result, Timer.startTime, startOffset, traceHistory);
    }
    Logger.traceHistory = [];
  }
};