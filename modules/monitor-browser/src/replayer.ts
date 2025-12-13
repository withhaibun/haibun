#!/usr/bin/env node

import { WebSocketTransport } from './transport.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const args = process.argv.slice(2);
const fileArg = args.find(a => !a.startsWith('--'));
const portArg = args.find(a => a.startsWith('--port='));

if (!fileArg) {
  console.error('Usage: haibun-replay <events.ndjson> [--port=8080]');
  process.exit(1);
}

const port = portArg ? parseInt(portArg.split('=')[1], 10) : 8080;
const transport = new WebSocketTransport(port);

const filePath = resolve(process.cwd(), fileArg);
console.log(`Loading events from ${filePath}...`);

try {
  const content = readFileSync(filePath, 'utf-8');
  const events = content.trim().split('\n').map(line => JSON.parse(line));

  console.log(`Loaded ${events.length} events.`);
  console.log(`Waiting for browser connection on port ${port}...`);

  transport.onMessage((data: any) => {
    if (data.type === 'ready') {
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
