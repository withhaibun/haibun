import { describe, it, expect } from 'vitest';
import { passWithDefaults, DEF_PROTO_OPTIONS } from '@haibun/core/lib/test/lib.js';
import { AStepper } from '@haibun/core/lib/astepper.js';
import { OK, type TStepArgs } from '@haibun/core/schema/protocol.js';
import { actionNotOK, actionOKWithProducts, getStepperOptionName } from '@haibun/core/lib/util/index.js';
import WebServerStepper from './web-server-stepper.js';

class PingStepper extends AStepper {
  steps = {
    ping: {
      gwta: 'ping',
      action: async () => actionOKWithProducts({ pong: true }),
    },
  };
}

class RpcVerifyStepper extends AStepper {
  steps = {
    rpcStepListIncludes: {
      gwta: 'rpc step list at {url} includes {stepName}',
      action: async ({ url, stepName }: TStepArgs) => {
        const res = await fetch(String(url), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'step.list', params: {} }),
        });
        if (!res.ok) return actionNotOK(`HTTP ${res.status}`);
        const data = await res.json();
        const steps = Array.isArray(data) ? data : (data as { steps?: { method: string }[] }).steps ?? [];
        const methods = steps.map((s: { method: string }) => s.method);
        return methods.includes(String(stepName)) ? OK : actionNotOK(`"${stepName}" not in [${methods.join(', ')}]`);
      },
    },
    rpcCallSucceeds: {
      gwta: 'rpc call to {url} with method {method} succeeds',
      action: async ({ url, method }: TStepArgs) => {
        const res = await fetch(String(url), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: String(method), params: {} }),
        });
        if (!res.ok) return actionNotOK(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.error) return actionNotOK(data.error);
        return OK;
      },
    },
    rpcOldFormatIgnored: {
      gwta: 'rpc old format to {url} is not dispatched',
      action: async ({ url }: TStepArgs) => {
        const res = await fetch(String(url), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'rpc', id: '1', method: 'step.list', params: {} }),
        });
        const data = await res.json();
        // Old format is not parsed as a valid JSON-RPC 2.0 request, so no handler processes it.
        // Transport returns { ok: true } as default (no handler matched).
        if (Array.isArray(data)) return actionNotOK('Got step.list response — old format should not be dispatched');
        return OK;
      },
    },
  };
}

function makeOptions(port: number) {
  return {
    ...DEF_PROTO_OPTIONS,
    moduleOptions: { [getStepperOptionName(WebServerStepper, 'PORT')]: String(port) },
  };
}

const steppers = [WebServerStepper, PingStepper, RpcVerifyStepper];

describe('RPC dispatch via WebServerStepper', () => {
  it('step.list includes PingStepper-ping', async () => {
    const port = 8234;
    const feature = {
      path: '/features/test.feature',
      content: `
enable rpc
webserver is listening for "rpc-step-list"
rpc step list at "http://localhost:${port}/rpc/step.list" includes "PingStepper-ping"
`,
    };
    const result = await passWithDefaults([feature], steppers, makeOptions(port));
    expect(result.ok).toBe(true);
  });

  it('executes a step via RPC', async () => {
    const port = 8235;
    const feature = {
      path: '/features/test.feature',
      content: `
enable rpc
webserver is listening for "rpc-step-exec"
rpc call to "http://localhost:${port}/rpc/PingStepper-ping" with method "PingStepper-ping" succeeds
`,
    };
    const result = await passWithDefaults([feature], steppers, makeOptions(port));
    expect(result.ok).toBe(true);
  });

  it('rejects old-format RPC envelope', async () => {
    const port = 8236;
    const feature = {
      path: '/features/test.feature',
      content: `
enable rpc
webserver is listening for "rpc-old-format"
rpc old format to "http://localhost:${port}/rpc/step.list" is not dispatched
`,
    };
    const result = await passWithDefaults([feature], steppers, makeOptions(port));
    expect(result.ok).toBe(true);
  });
});
