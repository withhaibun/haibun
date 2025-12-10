import { AStepper, TStepperSteps } from '../lib/astepper.js';
import { OK, TFeatureStep, TWorld, TActionResult } from '../lib/defs.js';
import { actionNotOK, sleep } from '../lib/util/index.js';
import { FlowRunner } from '../lib/core/flow-runner.js';
import { DOMAIN_STATEMENT, normalizeDomainKey } from '../lib/domain-types.js';


export default class LogicStepper extends AStepper {
  steppers: AStepper[] = [];
  private runner: FlowRunner;

  async setWorld(world: TWorld, steppers: AStepper[]) {
    this.world = world;
    this.steppers = steppers;
    this.runner = new FlowRunner(world, steppers);
  }

  steps = {
    // -------------------------------------------------------------------------
    // CONTROL FLOW (The Gates)
    // -------------------------------------------------------------------------

    // RECURRENCE: While(Condition) { Action }
    whenever: {
      gwta: 'whenever {condition:statement}, {action:statement}',
      action: async ({ condition, action }: { condition: TFeatureStep[], action: TFeatureStep[] }, featureStep: TFeatureStep): Promise<TActionResult> => {
        let loopCount = 0;
        const MAX_LOOPS = 1000;
        const mode = featureStep.intent?.mode === 'speculative' ? 'speculative' : 'authoritative';
        const usage = featureStep.intent?.usage;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (loopCount++ > MAX_LOOPS) return actionNotOK('whenever: infinite loop detected');

          const check = await this.runner.runSteps(condition, { intent: { mode: 'speculative', usage }, parentStep: featureStep });

          if (check.kind !== 'ok') break;

          const result = await this.runner.runSteps(action, { intent: { mode, usage }, parentStep: featureStep });

          if (result.kind !== 'ok') {
            return actionNotOK(`whenever: action failed: ${result.message}`);
          }
          await sleep(0);
        }
        return OK;
      }
    },

    // IMPLICATION: If P then Q
    where: {
      gwta: 'where {condition:statement}, {action:statement}',
      action: async ({ condition, action }: { condition: TFeatureStep[], action: TFeatureStep[] }, featureStep: TFeatureStep): Promise<TActionResult> => {
        const usage = featureStep.intent?.usage;
        const check = await this.runner.runSteps(condition, { intent: { mode: 'speculative', usage }, parentStep: featureStep });

        // Vacuously true if condition is false
        if (check.kind !== 'ok') return OK;

        const mode = featureStep.intent?.mode === 'speculative' ? 'speculative' : 'authoritative';
        const result = await this.runner.runSteps(action, { intent: { mode, usage }, parentStep: featureStep });

        return result.kind === 'ok' ? OK : actionNotOK(`Constraint failed: Condition was true, but Action failed: ${result.message}`);
      }
    },

    // DISJUNCTION: A or B or C
    anyOf: {
      match: /^any of (.*)/,
      action: async (_: unknown, featureStep: TFeatureStep): Promise<TActionResult> => {
        let statements = featureStep.in.replace(/^any of /i, '').trim();
        if ((statements.startsWith('"') && statements.endsWith('"')) || (statements.startsWith('`') && statements.endsWith('`'))) {
          statements = statements.slice(1, -1);
        }
        const statementList = statements.split(',').map(s => s.trim());
        for (const statement of statementList) {
          const res = await this.runner.runStatements([statement], { intent: { mode: 'speculative' }, parentStep: featureStep });
          if (res.kind === 'ok') return OK;
          this.getWorld().logger.debug(`any of: statement "${statement}" failed: ${res.message}`);
        }
        return actionNotOK('No conditions in the list were satisfied');
      }
    },

    // NEGATION: Not P
    not: {
      gwta: `not {statements:${DOMAIN_STATEMENT}}`,
      action: async ({ statements }: { statements: TFeatureStep[] }, featureStep: TFeatureStep): Promise<TActionResult> => {
        // Speculative mode catches recursion depth errors
        const res = await this.runner.runSteps(statements, { intent: { mode: 'speculative' }, parentStep: featureStep });

        if (res.kind === 'fail') {
          return OK;
        } else {
          return actionNotOK('not statement was true (failed negation)');
        }
      },
    },

    // -------------------------------------------------------------------------
    // QUANTIFIERS (The Iterators)
    // -------------------------------------------------------------------------

    // EXISTENTIAL: Exists x in D such that P(x)
    some: {
      match: /^some (.*) in (.*?) is (.*)/,
      action: async (_: unknown, featureStep: TFeatureStep): Promise<TActionResult> => {
        const match = featureStep.in.match(/^some (.*) in (.*?) is (.*)/);
        if (!match) return actionNotOK('some: invalid syntax');
        const [, variable, domain, checkStr] = match;

        if (!domain) {
          return actionNotOK('Missing domain in some step');
        }
        const domainKey = normalizeDomainKey(domain);
        const domainDef = this.getWorld().domains[domainKey];

        if (!domainDef || !Array.isArray(domainDef.values)) {
          return actionNotOK(`Domain "${domain}" is not an enumerable set`);
        }

        let found = false;
        const mode = 'speculative';

        for (const val of domainDef.values) {
          const argVal = typeof val === 'string' ? `"${val}"` : String(val);
          const res = await this.runner.runStatements([checkStr], { args: { [variable]: argVal }, intent: { mode }, parentStep: featureStep });
          if (res.kind === 'ok') {
            found = true;
            break;
          }
        }

        return found ? OK : actionNotOK(`No ${variable} in ${domain} satisfied the condition`);
      }
    },

    // UNIVERSAL: For All x in D, P(x)
    every: {
      match: /^every (.*) in (.*?) is (.*)/,
      action: async (_: unknown, featureStep: TFeatureStep): Promise<TActionResult> => {
        const match = featureStep.in.match(/^every (.*) in (.*?) is (.*)/);
        if (!match) return actionNotOK('every: invalid syntax');
        const [, variable, domain, checkStr] = match;

        if (!domain) {
          return actionNotOK('Missing domain in every step');
        }
        const domainKey = normalizeDomainKey(domain);
        const domainDef = this.getWorld().domains[domainKey];

        if (!domainDef || !Array.isArray(domainDef.values)) {
          return actionNotOK(`Domain "${domain}" is not an enumerable set`);
        }

        const mode = featureStep.intent?.mode === 'speculative' ? 'speculative' : 'authoritative';

        for (const val of domainDef.values) {
          const argVal = String(val);
          const res = await this.runner.runStatements([checkStr], { args: { [variable]: argVal }, intent: { mode }, parentStep: featureStep });
          if (res.kind !== 'ok') {
            return actionNotOK(`Universal check failed for value "${val}": ${res.message}`);
          }
        }
        return OK;
      }
    },
  } satisfies TStepperSteps;
}
