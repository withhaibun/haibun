import fs from 'fs';
import { fileURLToPath } from 'url';

import { AStepper, IHasCycles, IHasOptions, StepperKinds } from '@haibun/core/lib/astepper.js';
import { IStepperCycles, TWorld } from '@haibun/core/lib/defs.js';
import { OK } from '@haibun/core/schema/protocol.js';
import { THaibunEvent } from '@haibun/core/schema/protocol.js';
import { stringOrError, actualURI, findStepperFromOptionOrKind, intOrError, getStepperOption } from '@haibun/core/lib/util/index.js';
import { SSEPrompter } from './prompter.js';
import { AStorage } from '@haibun/domain-storage/AStorage.js';
import { JITSerializer } from '@haibun/core/monitor/index.js';
import { EMediaTypes } from '@haibun/domain-storage/media-types.js';
import { ITransport } from './sse-transport.js';
import { setupTransport } from './lib/setup-transport.js';
import path from 'path';

export const LOG_HOST_STARTED = 'MonitorBrowser: Starting as Host on port';
export const LOG_CLIENT_PIGGYBACKING = 'MonitorBrowser: Found running monitor on port';
export const LOG_INGESTED = 'MonitorBrowser: Ingested event from piggybacker';

export default class MonitorBrowserStepper extends AStepper implements IHasCycles, IHasOptions {
  description = 'Real-time browser dashboard with SSE events and debugging';
  port = 0;

  kind = StepperKinds.MONITOR;
  static transport: ITransport;
  prompter: SSEPrompter | undefined;
  storage!: AStorage;
  events: THaibunEvent[] = [];

  options = {
    PORT: {
      desc: 'Port for web server',
      parse: (port: string) => intOrError(port),
    },
    INTERFACE: {
      desc: 'Interface for web server',
      parse: stringOrError,
    },
    [StepperKinds.STORAGE]: {
      desc: 'Storage for output',
      parse: stringOrError,
    }
  };

  captureRoot: string | undefined;

  // Static base path for transport (capture/DEST/key/ without seq/featn)
  static transportRoot: string | undefined;
  interface: string | undefined;

  async setWorld(world: TWorld, steppers: AStepper[]) {
    super.setWorld(world, steppers);
    this.storage = findStepperFromOptionOrKind(steppers, this, world.moduleOptions, StepperKinds.STORAGE);
    const portOption = getStepperOption(this, 'PORT', world.moduleOptions);
    if (portOption) {
      this.port = parseInt(portOption); // portOption is already vaidated as int using intOrError
    }
    this.interface = getStepperOption(this, 'INTERFACE', world.moduleOptions);

    // Get the current feature's capture location
    const loc = { ...world, mediaType: EMediaTypes.html };
    this.captureRoot = await this.storage.getCaptureLocation(loc);

    // Setup debugger bridge with placeholder transport
    // debugger bridge setup...
    const dummy: ITransport = { send: () => void 0, onMessage: () => void 0 };
    this.prompter = new SSEPrompter(dummy);
    world.prompter.subscribe(this.prompter);
  }

  cycles: IStepperCycles = {
    startFeature: async () => {
      if (!MonitorBrowserStepper.transport) {
        await setupTransport(this);
      }
    },
    onEvent: (event: THaibunEvent) => {
      this.events.push(event);
      if (MonitorBrowserStepper.transport) {
        MonitorBrowserStepper.transport.send({ type: 'event', event });
      }
    },
    endFeature: async () => {
      MonitorBrowserStepper.transport.send({ type: 'finalize' });

      const transformedEvents = this.events.map(e => {
        // Type guard for artifact events with path property
        if (e.kind === 'artifact' && 'path' in e) {
          const artifactEvent = e as typeof e & { path: string };
          const artifactPath = artifactEvent.path;
          const match = artifactPath.match(/^featn-\d+(?:-[^/]*)?\/(.*)/);
          if (match) {
            return { ...e, path: './' + match[1] };
          }
          // If already a relative path like ./subpath/file.ext, keep it
          if (artifactPath.startsWith('./')) {
            return e;
          }
          // Otherwise prepend ./ for relative path
          return { ...e, path: './' + artifactPath };
        }
        return e;
      });

      // Serialize and save report  
      const serializer = new JITSerializer();
      const jitData = serializer.serialize(transformedEvents);

      const featureStart = this.events.find(e => e.kind === 'lifecycle' && e.type === 'feature' && e.stage === 'start');
      const world = this.getWorld();
      const featureLabel = (featureStart && 'label' in featureStart ? featureStart.label as string : undefined) || world.runtime.feature || 'report';
      const topic = featureLabel.replace(/.*\//, '').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_]/g, '_');


      await this.saveSerializedReport(jitData, topic);
      this.events = [];
    },
    endExecution: () => {
      MonitorBrowserStepper.transport.send({ type: 'finalize' });
      return Promise.resolve();
    }
  };

  private async saveSerializedReport(jitData: string, topic: string) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const indexPath = path.join(__dirname, '..', 'dist', 'client', 'index.html');

    if (!fs.existsSync(indexPath)) {
      this.getWorld().eventLogger.error(`[MonitorBrowser] Could not find client build artifacts at ${indexPath}`);
      return;
    }

    let html = fs.readFileSync(indexPath, 'utf-8');

    // Inject JIT Data
    const injection = `<script id="haibun-data" type="application/json">${jitData}</script>`;
    const bodyEndIndex = html.lastIndexOf('</body>');
    if (bodyEndIndex !== -1) {
      html = html.substring(0, bodyEndIndex) + injection + html.substring(bodyEndIndex);
    } else {
      html += injection;
    }

    const saved = await this.storage.saveArtifact('monitor.html', html, EMediaTypes.html);

    this.getWorld().eventLogger.info(`[MonitorBrowser] Report saved: ${actualURI(saved.absolutePath)}`);
  }

  steps = {
    pause: {
      gwta: 'pause browser monitor',
      action: () => {
        // Implement pause logic if needed
        return OK;
      }
    }
  };
}
