import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPTransport } from '@hono/mcp';
import { z } from 'zod';
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, ErrorCode, McpError, type Tool, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { AStepper, type IHasCycles, type IHasOptions } from '@haibun/core/lib/astepper.js';
import type { TWorld, TStepperStep, TFeatureStep } from '@haibun/core/lib/defs.js';
import { OK, Origin } from '@haibun/core/schema/protocol.js';
import { getFromRuntime, getStepperOption, constructorName, stringOrError } from '@haibun/core/lib/util/index.js';
import { namedInterpolation } from '@haibun/core/lib/namedVars.js';
import { currentVersion as version } from '@haibun/core/currentVersion.js';
import { FeatureExecutor } from '@haibun/core/phases/Executor.js';
import { DOMAIN_STRING, normalizeDomainKey } from '@haibun/core/lib/domain-types.js';
import type { IWebServer, Context } from './defs.js';
import { WEBSERVER } from './defs.js';

// --- Type Definitions ---

type StoredTool = {
  name: string;
  description: string;
  inputSchema: Tool['inputSchema'];
  stepperName: string; // The Stepper (group) this tool belongs to
  handler: (input: Record<string, unknown>) => Promise<CallToolResult>;
};

type ConnectionId = object;

export default class McpStepper extends AStepper implements IHasOptions, IHasCycles {
  description = 'Expose all Haibun steps as callable MCP tools for LLM agents';

  options = {
    MCP_PATH: { desc: 'Path for MCP endpoint', parse: (p: string) => stringOrError(p) },
    ACCESS_TOKEN: { desc: 'Access token for MCP auth', parse: (t: string) => stringOrError(t) },
    PORT: { desc: 'Port to listen on (overrides WebServer default)', parse: (p: string) => stringOrError(p) }
  };

  cycles = {
    startFeature: async () => { await this.setupMcp(); },
    endFeature: async () => { await this.close(); },
  };

  private mcpServer?: McpServer;
  private transport?: StreamableHTTPTransport;
  private steppers: AStepper[] = [];

  private mcpPath = '/mcp';
  private accessToken = '';

  private globalToolRegistry = new Map<string, StoredTool>();
  private stepperToolRegistry = new Map<string, StoredTool[]>();
  private indexTools: Tool[] = [];
  // Switched to Map instead of WeakMap to support string SessionIDs (from headers)
  private sessionScopes = new Map<any, string>();

  async setWorld(world: TWorld, steppers: AStepper[]) {
    await super.setWorld(world, steppers);
    this.steppers = steppers;
    this.mcpPath = (getStepperOption(this, 'MCP_PATH', world.moduleOptions) as string) || '/mcp';
    this.accessToken = (getStepperOption(this, 'ACCESS_TOKEN', world.moduleOptions) as string) || '';
  }

  private async setupMcp() {
    if (this.mcpServer) return;

    if (!this.accessToken) {
      throw new Error('McpStepper: ACCESS_TOKEN is required. Configure HAIBUN_O_MCPSTEPPER_ACCESS_TOKEN environment variable.');
    }

    const webserver = getFromRuntime(this.getWorld().runtime, WEBSERVER) as IWebServer;
    if (!webserver) throw new Error('McpStepper: No webserver found in runtime.');

    this.mcpServer = new McpServer({ name: 'haibun-mcp', version }, { capabilities: { tools: {}, resources: {} } });
    this.transport = new StreamableHTTPTransport({ enableJsonResponse: true });

    this.indexTools = this.buildIndexTools();
    this.populateToolRegistries();

    // --- HANDLER 1: LIST TOOLS ---
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
      const connection = (extra as { connection?: ConnectionId })?.connection;
      const sessionId = this.getSessionId(connection, extra);

      const activeStepper = this.sessionScopes.get(sessionId);

      if (!activeStepper) {
        return { tools: this.indexTools };
      }

      const stepperTools = this.stepperToolRegistry.get(activeStepper) || [];
      const visibleTools: Tool[] = stepperTools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema
      }));

      visibleTools.unshift({
        name: 'return_to_index',
        description: 'Close current stepper tools and return to the main index of available steppers.',
        inputSchema: { type: 'object', properties: {} }
      });

      return { tools: visibleTools };
    });

    // --- HANDLER 2: CALL TOOL ---
    const defaultConnection = {};
    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const connection = (extra as { connection?: ConnectionId })?.connection || defaultConnection;
      const sessionId = this.getSessionId(connection, extra);

      const toolName = request.params.name;
      const args = (request.params.arguments as Record<string, unknown>) || {};

      if (toolName.startsWith('access_stepper_')) {
        const targetStepper = toolName.replace('access_stepper_', '');
        if (this.stepperToolRegistry.has(targetStepper)) {
          this.updateSessionFocus(sessionId, targetStepper);
          return { content: [{ type: 'text', text: `Loaded tools for stepper: ${targetStepper}.` }] };
        }
      }

      if (toolName === 'return_to_index') {
        this.updateSessionFocus(sessionId, undefined);
        return { content: [{ type: 'text', text: `Returned to index.` }] };
      }

      const toolDef = this.globalToolRegistry.get(toolName);
      if (!toolDef) {
        throw new McpError(ErrorCode.MethodNotFound, `Tool ${toolName} not found.`);
      }

      const currentFocus = this.sessionScopes.get(sessionId);
      if (toolDef.stepperName !== currentFocus) {
        this.getWorld().eventLogger.info(`[MCP] Auto-switching focus: ${currentFocus || 'Index'} -> ${toolDef.stepperName}`);
        this.updateSessionFocus(sessionId, toolDef.stepperName);
      }

      try {
        return await toolDef.handler(args);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: 'text', text: msg }] };
      }
    });

    // --- HANDLER 3: LIST RESOURCES ---
    this.mcpServer.server.setRequestHandler(ListResourcesRequestSchema, async (_request, _extra) => {
      return {
        resources: [
          {
            uri: `mcp://${this.mcpPath}/info`,
            name: 'Haibun MCP Server Info',
            mimeType: 'application/json',
            description: 'Basic information about this MCP server'
          }
        ]
      };
    });

    // --- HANDLER 4: READ RESOURCE ---
    this.mcpServer.server.setRequestHandler(ReadResourceRequestSchema, async (request, _extra) => {
      if (request.params.uri === `mcp://${this.mcpPath}/info`) {
        return {
          contents: [{
            uri: request.params.uri,
            mimeType: 'application/json',
            text: JSON.stringify({ version, name: 'haibun-mcp', status: 'running' })
          }]
        };
      }
      throw new McpError(ErrorCode.InvalidRequest, `Resource not found: ${request.params.uri}`);
    });

    await this.mcpServer.connect(this.transport);
    this.setupMiddleware(webserver);
    this.setupRoutes(webserver);
    this.getWorld().eventLogger.info(`🔗 MCP endpoint registered at ${this.mcpPath}`);

    // --- RESOLVE PORT (Fixed Priority) ---
    // 1. Check McpStepper options (highest priority)
    const myPortOpt = getStepperOption(this, 'PORT', this.getWorld().moduleOptions);
    // 2. Check WebServerStepper options
    const wsPortOpt = this.getWorld().moduleOptions?.['WebServerStepper']?.['PORT'];
    // 3. Check Environment variable
    const envPort = process.env['HAIBUN_O_WEBSERVERSTEPPER_PORT'];

    // Default to '8128' if nothing else is found.
    const rawPort = myPortOpt || wsPortOpt || envPort || '8128';
    const port = parseInt(String(rawPort), 10);

    try {
      await webserver.listen(port);
      this.getWorld().eventLogger.info(`[MCP] WebServer started on port ${port}`);
    } catch (e) {
      if ((e as { code?: string })?.code !== 'EADDRINUSE') {
        const msg = `[MCP] WebServer listen failure: ${e}`;
        this.getWorld().eventLogger.error(msg);
        throw new Error(msg);
      } else {
        this.getWorld().eventLogger.info(`[MCP] WebServer already listening on port ${port} (shared)`);
      }
    }
  }

  // --- Session ID Helper ---
  private getSessionId(connection: any, extra: any): any {
    // Try to get X-Session-ID header from request info
    const headers = extra?.requestInfo?.headers;
    if (headers && headers['x-session-id']) {
      return headers['x-session-id'];
    }
    // Fallback to connection object if available and stable (it isn't usually for HTTP)
    if (connection) return connection;
    return 'default-session';
  }

  private updateSessionFocus(sessionId: any, stepperName: string | undefined) {
    if (stepperName === undefined) {
      this.sessionScopes.delete(sessionId);
    } else {
      this.sessionScopes.set(sessionId, stepperName);
    }
    this.notifyToolListChanged(sessionId);
  }

  private async notifyToolListChanged(sessionId: any) {
    // Basic check if we can notify
    if (sessionId && typeof sessionId !== 'string' && 'send' in sessionId && typeof (sessionId as any).send === 'function') {
      await this.mcpServer!.server.notification({ method: 'notifications/tools/list_changed' });
    }
  }

  private buildIndexTools(): Tool[] {
    return this.steppers.map(stepper => {
      const name = constructorName(stepper);
      const desc = stepper.description || `Load the toolset for stepper: ${name}.`;
      return {
        name: `access_stepper_${name}`,
        description: desc,
        inputSchema: { type: 'object', properties: {} }
      };
    });
  }

  private populateToolRegistries() {
    for (const stepper of this.steppers) {
      const stepperName = constructorName(stepper);
      const tools: StoredTool[] = [];

      for (const [stepName, stepDef] of Object.entries(stepper.steps)) {
        if (stepDef.expose === false) continue;

        const variables: Record<string, z.ZodTypeAny> = {};
        if (stepDef.gwta) {
          const { stepValuesMap } = namedInterpolation(stepDef.gwta);
          if (stepValuesMap) {
            for (const v of Object.values(stepValuesMap)) {
              const rawDomain = v.domain || DOMAIN_STRING;
              const parts = rawDomain.split(' | ').sort();
              const domainKey = normalizeDomainKey(parts.join(' | '));
              const domain = this.world.domains[domainKey];
              variables[v.term] = (domain?.schema as unknown as z.ZodTypeAny) || z.string();
            }
          }
        }

        const zodShape = z.object(variables);
        const jsonSchema = (zodToJsonSchema as (schema: unknown) => unknown)(zodShape);
        const inputSchema = jsonSchema as Tool['inputSchema'];
        const fullToolName = `${stepperName}-${stepName}`;

        const tool: StoredTool = {
          name: fullToolName,
          description: stepDef.gwta || stepName,
          inputSchema,
          stepperName,
          handler: this.createToolHandler(stepperName, stepName, stepDef)
        };
        tools.push(tool);
        this.globalToolRegistry.set(fullToolName, tool);
      }
      this.stepperToolRegistry.set(stepperName, tools);
    }
  }

  private createToolHandler(stepperName: string, stepName: string, stepDef: TStepperStep) {
    return async (input: Record<string, unknown>): Promise<CallToolResult> => {
      this.getWorld().eventLogger.info(`[MCP] Tool Execution: ${stepperName}-${stepName}`);

      const featureStep: TFeatureStep = {
        in: stepDef.gwta || '',
        action: {
          stepperName,
          actionName: stepName,
          step: stepDef,
          stepValuesMap: this.mapInputToValues(input, stepDef),
        },
        seqPath: [0],
        source: { path: 'mcp' }
      };

      const result = await FeatureExecutor.doFeatureStep(this.steppers, featureStep, this.world);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    };
  }

  private mapInputToValues(input: Record<string, unknown>, stepDef: TStepperStep) {
    const { stepValuesMap } = namedInterpolation(stepDef.gwta || '');
    const updatedMap = { ...stepValuesMap };
    for (const [key, val] of Object.entries(input)) {
      if (key in updatedMap) {
        updatedMap[key] = { ...updatedMap[key], term: String(val), origin: Origin.quoted };
      }
    }
    return updatedMap;
  }

  private setupMiddleware(webserver: IWebServer) {
    const applyMcpMiddleware = async (c: Context, next: () => Promise<void>) => {
      // 1. CORS
      c.header('Access-Control-Allow-Origin', '*');
      c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Custom-Header, X-Session-ID');

      if (c.req.method === 'OPTIONS') return c.body(null, 204);

      // 2. Auth
      if (this.accessToken) {
        const auth = c.req.header('authorization');
        if (!auth?.startsWith('Bearer ') || auth.slice(7) !== this.accessToken) {
          return c.json({ error: 'Unauthorized' }, 401);
        }
      }

      // 3. Disable Compression (Critical for SSE)
      c.header('Cache-Control', 'no-transform');

      await next();
    };

    webserver.app.use(this.mcpPath, applyMcpMiddleware);
    webserver.app.use(`${this.mcpPath}/*`, applyMcpMiddleware);
  }

  private setupRoutes(webserver: IWebServer) {
    const handleMcpRequest = async (c: Context) => {
      const strictAccept = 'application/json, text/event-stream';
      const newHeaders = new Headers(c.req.raw.headers);

      // Ensure the transport always sees a valid Accept header
      if (!newHeaders.has('Accept')) {
        newHeaders.set('Accept', strictAccept);
      }

      // 1. CLONE OR PROXY THE RAW REQUEST
      // For GET requests, we manually construct a new Request object.
      // For non-GET (POST), we MUST avoid the Request constructor as it doesn't reuse the body.
      // Instead, we proxy the raw request to intercept header access.
      const cleanRawRequest = (c.req.method === 'GET')
        ? new Request(c.req.raw, { headers: newHeaders } as RequestInit)
        : new Proxy(c.req.raw, {
          get(target, prop) {
            if (prop === 'headers') return newHeaders;
            const val = Reflect.get(target, prop);
            return typeof val === 'function' ? val.bind(target) : val;
          }
        });

      // 2. CREATE A ROBUST PROXY FOR THE CONTEXT
      // We must bind all functions to the original target to avoid 
      // TypeError: Cannot read private member #cachedBody
      const proxyContext = new Proxy(c, {
        get(target, prop) {
          if (prop === 'req') {
            return new Proxy(target.req, {
              get(reqTarget, reqProp) {
                // A. Intercept raw request access
                if (reqProp === 'raw') return cleanRawRequest;

                // B. Intercept Hono's header() helper
                if (reqProp === 'header') {
                  return (name?: string) => {
                    // Case 1: c.req.header('accept') -> return string
                    if (name) return newHeaders.get(name);

                    // Case 2: c.req.header() -> return Record<string, string>
                    const all: Record<string, string> = {};
                    newHeaders.forEach((v, k) => { all[k] = v; });
                    return all;
                  };
                }

                // C. Pass through everything else, binding functions to avoid private member issues
                const val = Reflect.get(reqTarget, reqProp);
                return typeof val === 'function' ? (val as Function).bind(reqTarget) : val;
              }
            });
          }
          const val = Reflect.get(target, prop);
          return typeof val === 'function' ? (val as Function).bind(target) : val;
        }
      });

      const response = await this.transport!.handleRequest(proxyContext);

      if (!response) {
        this.getWorld().eventLogger.warn('[MCP] No response generated by transport');
        return c.notFound();
      }
      return response;
    };

    webserver.app.all(this.mcpPath, handleMcpRequest);
    webserver.app.all(`${this.mcpPath}/*`, handleMcpRequest);
  }

  async close() {
    if (this.mcpServer) await this.mcpServer.close();
    this.mcpServer = undefined;
    this.transport = undefined;
  }

  steps = {
    serveMcpTools: {
      gwta: 'serve mcp tools at {path}',
      action: async ({ path }: { path: string }) => {
        this.mcpPath = String(path);
        await this.setupMcp();
        return OK;
      },
    },
  };
}