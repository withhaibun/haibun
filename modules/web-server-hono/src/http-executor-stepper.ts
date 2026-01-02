import { AStepper, type IHasCycles, type IHasOptions } from '@haibun/core/lib/astepper.js';
import type { TWorld } from '@haibun/core/lib/defs.js';
import type { TStepResult, TStepActionResult } from '@haibun/core/schema/protocol.js';
import { FlowRunner } from '@haibun/core/lib/core/flow-runner.js';
import { getFromRuntime, getStepperOption, getStepperOptionName, intOrError, stringOrError } from '@haibun/core/lib/util/index.js';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';

import type { IWebServer, TRequestHandler } from './defs.js';
import { WEBSERVER } from './defs.js';
import { HttpPrompter } from './http-prompter.js';

export default class HttpExecutorStepper extends AStepper implements IHasOptions, IHasCycles {
  options = {
    LISTEN_PORT: {
      desc: 'Port for remote execution API',
      parse: (port: string) => intOrError(port),
    },
    ACCESS_TOKEN: {
      desc: 'Access token for remote execution API authentication',
      parse: (token: string) => stringOrError(token),
    },
  };
  cycles = {
    startFeature: async () => {
      this.httpPrompter = new HttpPrompter(this.getWorld());
      await this.addRemoteExecutorRoute();
    },
    endFeature: async () => {
      await this.close();
    },
  };

  private routeAdded = false;
  private steppers: AStepper[] = [];
  protected httpPrompter?: HttpPrompter;
  configuredToken: string = '';
  port: number = 0;
  private runner!: FlowRunner;

  async setWorld(world: TWorld, steppers: AStepper[]) {
    await super.setWorld(world, steppers);
    this.runner = new FlowRunner(world, steppers);

    const portResult = intOrError(getStepperOption(this, 'LISTEN_PORT', world.moduleOptions) as string || '');
    this.port = portResult.result || Number.NaN;
    this.configuredToken = getStepperOption(this, 'ACCESS_TOKEN', this.getWorld().moduleOptions) as string || '';
    this.steppers = steppers;
    if (Number.isNaN(this.port) || !this.configuredToken) {
      throw new Error(
        `${getStepperOptionName(this, 'LISTEN_PORT')} and ${getStepperOptionName(this, 'ACCESS_TOKEN')} are required for remote execution`,
      );
    }
  }

  addRemoteExecutorRoute() {
    if (this.routeAdded) {
      return;
    }

    const webserver = getFromRuntime(this.getWorld().runtime, WEBSERVER) as IWebServer;
    if (!webserver) {
      throw new Error('WebServer not available - ensure web-server-stepper is loaded');
    }
    void webserver.listen(this.port);

    // Execute step route
    const executeHandler: TRequestHandler = async (c: Context) => {
      try {
        const body = await c.req.json<{ statement?: string; source?: string }>();
        this.getWorld().eventLogger.info(`📥 HTTP Executor: Received request for statement: "${body?.statement}"`);

        if (!this.checkAuth(c)) {
          return c.json({ error: 'Invalid or missing access token' }, 401);
        }

        if (typeof body.statement !== 'string' || typeof body.source !== 'string') {
          this.getWorld().eventLogger.warn(`missing or invalid body parameters: ${JSON.stringify(body)}`);
          return c.json({ error: 'statement and source are required' }, 400);
        }

        const { statement, source } = body;
        this.getWorld().eventLogger.debug?.(`🔄 HTTP Executor: Starting execution of "${statement}" from ${source}`);

        const result: TStepResult = await (async () => {
          const stepInput = { in: statement, source: { path: source } };
          const res = await this.runner.runStatement(stepInput, {
            intent: { mode: 'authoritative' },
            seqPath: [0],
          });
          return {
            ok: res.kind === 'ok',
            in: statement,
            path: source,
            seqPath: [0],
            stepActionResult: res.topics as TStepActionResult,
          };
        })();

        this.getWorld().eventLogger.debug?.(`✅ HTTP Executor: Execution completed`);
        return c.json(result);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : 'No stack trace';
        this.getWorld().eventLogger.error?.(`❌ HTTP Executor: Error during execution: ${errorMessage}`, { stack });
        return c.json({ error: errorMessage, success: false }, 500);
      }
    };
    webserver.addRoute('post', '/execute-step', executeHandler);

    // Get pending prompts route
    const promptsHandler: TRequestHandler = async (c: Context) => {
      if (!this.checkAuth(c)) {
        return c.json({ error: 'Invalid or missing access token' }, 401);
      }
      if (!this.httpPrompter) {
        return c.json({ error: 'HTTP Prompter not initialized' }, 500);
      }
      const prompts = this.httpPrompter.getPendingPrompts();
      return c.json({ prompts });
    };
    webserver.addRoute('get', '/prompts', promptsHandler);

    // Respond to prompt route
    const promptHandler: TRequestHandler = async (c: Context) => {
      try {
        if (!this.checkAuth(c)) {
          return c.json({ error: 'Invalid or missing access token' }, 401);
        }

        const body = await c.req.json<{ promptId?: string; response?: string }>();
        if (body.promptId === undefined || body.response === undefined) {
          return c.json({ error: 'promptId and response are required' }, 400);
        }

        if (!this.httpPrompter) {
          return c.json({ error: 'HTTP Prompter not initialized' }, 500);
        }
        this.httpPrompter.resolve(body.promptId, body.response);
        return c.json({ success: true, promptId: body.promptId });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return c.json({ error: errorMessage }, 500);
      }
    };
    webserver.addRoute('post', '/prompt', promptHandler);

    this.routeAdded = true;
    this.getWorld().eventLogger.warn(`⚠️  Remote executor route added with ACCESS_TOKEN on port ${this.port}.`);
  }

  checkAuth(c: Context): boolean {
    const authHeader = c.req.header('authorization');
    const providedToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!providedToken || providedToken !== this.configuredToken) {
      this.getWorld().eventLogger.warn(`Unauthorized access attempt with token: "${providedToken}"`);
      return false;
    }

    return true;
  }

  steps = {};

  close() {
    if (this.httpPrompter) {
      this.world.prompter.unsubscribe(this.httpPrompter);
      this.httpPrompter = undefined;
    }
  }
}
