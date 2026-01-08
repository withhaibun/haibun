#!/usr/bin/env node

import { SSETransport } from './sse-transport.js';
import { ServerHono } from '@haibun/web-server-hono/server-hono.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { IEventLogger } from '@haibun/core/lib/EventLogger.js';

const args = process.argv.slice(2);
const fileArg = args.find(a => !a.startsWith('--'));
const portArg = args.find(a => a.startsWith('--port='));

if (!fileArg) {
  console.error('Usage: haibun-replay <events.ndjson> [--port=3459]');
  process.exit(1);
}

const port = portArg ? parseInt(portArg.split('=')[1], 10) : 3459;
const logger = {
  info: console.log,
  error: console.error,
  warn: console.warn,
  debug: console.debug,
  log: () => { /* noop */ },
  emit: () => { /* noop */ },
} as unknown as IEventLogger;

const webserver = new ServerHono(logger, process.cwd());
await webserver.listen(port);


const transport = new SSETransport(webserver, logger);

const filePath = resolve(process.cwd(), fileArg);
console.log(`Loading events from ${filePath}...`);

try {
  const content = readFileSync(filePath, 'utf-8');
  const events = content.trim().split('\n').map(line => JSON.parse(line));

  console.log(`Loaded ${events.length} events.`);
  console.log(`Waiting for browser connection on port ${port}...`);

  transport.onMessage((data: unknown) => {
    const msg = data as { type?: string };
    if (msg.type === 'ready') {
      console.log('Client connected, sending events...');
      // Send all events at once for replay
      // In future we could stream them with original timing
      for (const event of events) {
        transport.send({ type: 'event', event });
      }
      transport.send({ type: 'end' });
    }
  });

} catch (e) {
  console.error(`Failed to read file: ${e.message}`);
  process.exit(1);
}
