import path from 'path';
import fs from 'fs';
import { ServerHono } from '@haibun/web-server-hono/server-hono.js';
import { getPorts } from '../config.js';
import { serveStatic } from '@hono/node-server/serve-static';
import { SSETransport } from './../sse-transport.js';
import { RemoteTransport } from '../remote-transport.js';

import MonitorBrowserStepper, { LOG_CLIENT_PIGGYBACKING, LOG_HOST_STARTED, LOG_INGESTED } from '../monitor-browser-stepper.js';
import { fileURLToPath } from 'url';
import { getStepperOption } from '@haibun/core/lib/util/index.js';
import { SSEPrompter } from '../prompter.js';

export const setupTransport = async (monitorBrowser: MonitorBrowserStepper) => {
  const { clientPort, serverPort } = getPorts(process.env.NODE_ENV);
  const configuredPort = monitorBrowser.port || serverPort;

  await tryExisting(monitorBrowser, configuredPort).catch(async () => {
    await setupNew(monitorBrowser, configuredPort, clientPort);
  });

  if (!MonitorBrowserStepper.transport) {
    // Fallback just in case
    throw new Error('MonitorBrowserStepper: Transport initialization failed');
  }

  MonitorBrowserStepper.transportRoot = monitorBrowser.storage.getArtifactBasePath();

  // Update prompter transport
  monitorBrowser.prompter?.setTransport(MonitorBrowserStepper.transport);

  // Send cwd to client
  MonitorBrowserStepper.transport.send({ type: 'init', cwd: process.cwd() });
  return MonitorBrowserStepper.transport;
}

async function tryExisting(monitorBrowser: MonitorBrowserStepper, configuredPort: number) {
  // Try to connect to existing monitor
  const check = await fetch(`http://127.0.0.1:${configuredPort}/api/health`).catch((_e: unknown): null => null);
  if (check?.ok) {
    const text = await check.text();
    monitorBrowser.getWorld().eventLogger.debug(`${LOG_CLIENT_PIGGYBACKING} ${configuredPort} (${text})`);
    // Client Mode
    MonitorBrowserStepper.transport = new RemoteTransport(`http://127.0.0.1:${configuredPort}/api/ingest`, monitorBrowser.getWorld().eventLogger);
  } else {
    throw new Error('Not found');
  }
}

async function setupNew(monitorBrowser: MonitorBrowserStepper, configuredPort: number, clientPort: number) {
  console.error(`${LOG_HOST_STARTED} ${configuredPort} (PID: ${process.pid})`);
  monitorBrowser.getWorld().eventLogger.debug(`${LOG_HOST_STARTED} ${configuredPort} (PID: ${process.pid})`);

  const filesBase = path.join(process.cwd(), 'files');
  const server = new ServerHono(monitorBrowser.getWorld().eventLogger, filesBase);

  // Serve capture artifacts (images, videos, etc.) from the storage location
  // Must be registered before wildcard static routes
  const captureRoot = monitorBrowser.storage.getArtifactBasePath();
  if (captureRoot) {
    server.app.use('/featn-*', serveStatic({
      root: path.dirname(captureRoot), // Parent of captureRoot since /featn-N is included in the path
      rewriteRequestPath: (reqPath) => {
        // Keep the /featn-N/... path as-is relative to the capture directory's parent
        return reqPath;
      }
    }));
  }

  // Asset Serving (Dev vs Prod)
  let checkDev: Response | null = null;
  try {
    checkDev = await fetch(`http://127.0.0.1:${clientPort}`);
  } catch {
    // Dev server not running
  }

  const isDev = !!checkDev?.ok;

  if (isDev) {
    monitorBrowser.getWorld().eventLogger.info(`MonitorBrowser: Dev mode detected; UI is available on port ${clientPort}.`);
  } else {
    // Prod: Serve static files
    const distPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/client');
    if (fs.existsSync(distPath)) {
      server.app.use('/*', serveStatic({ root: distPath }));
    } else {
      monitorBrowser.getWorld().eventLogger.info(`MonitorBrowser: Serving static assets from ${distPath}`);
    }
  }

  // Add health/ingest endpoints for piggybackers
  server.addRoute('get', '/api/health', (c) => c.text(`OK ${process.pid}`));
  server.addRoute('post', '/api/ingest', async (c) => {
    const event = await c.req.json();
    console.error(`${LOG_INGESTED}: ${event.kind}`);
    monitorBrowser.getWorld().eventLogger.debug(`${LOG_INGESTED}: ${event.kind}`);
    MonitorBrowserStepper.transport?.send({ type: 'event', event });
    return c.text('OK');
  });

  // Initialize Runtime Server
  monitorBrowser.interface = getStepperOption(monitorBrowser, 'INTERFACE', monitorBrowser.getWorld().moduleOptions);
  await server.listen('monitor-browser SSE', configuredPort, monitorBrowser.interface);
  MonitorBrowserStepper.transport = new SSETransport(server, monitorBrowser.getWorld().eventLogger);
  monitorBrowser.prompter = new SSEPrompter(MonitorBrowserStepper.transport);
}

