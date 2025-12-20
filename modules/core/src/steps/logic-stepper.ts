import { AStepper, TStepperSteps, IHasCycles } from '../lib/astepper.js';
import { TFeatureStep, TWorld, IObservationSource, IStepperCycles } from '../lib/defs.js';
import { OK, TActionResult, Origin } from '../schema/protocol.js';
import { actionNotOK, sleep } from '../lib/util/index.js';
import { FlowRunner } from '../lib/core/flow-runner.js';
import { DOMAIN_STATEMENT } from '../lib/domain-types.js';

// Built-in observation sources
// Note: Step names are sanitized (dots → underscores) to avoid variable name conflicts

const sanitizeKey = (key: string) => key.replace(/\./g, '_');

const builtInSources: IObservationSource[] = [
  {
    name: 'step usage',
    observe: (world: TWorld) => {
      const usage = (world.runtime.observations?.get('stepUsage') as Map<string, number>) || new Map();
      const items = [...usage.keys()].map(sanitizeKey);
      const metrics: Record<string, Record<string, any>> = {};
      for (const [key, count] of usage.entries()) {
        metrics[sanitizeKey(key)] = { count };
      }
      return { items, metrics };
    }
  },
  {
    name: 'stepper usage',
    observe: (world: TWorld) => {
      const usage = (world.runtime.observations?.get('stepUsage') as Map<string, number>) || new Map();
      const stepperCounts = new Map<string, number>();
      for (const [key, count] of usage.entries()) {
        const stepperName = key.split('.')[0];
        stepperCounts.set(stepperName, (stepperCounts.get(stepperName) || 0) + count);
      }
      const items = [...stepperCounts.keys()];
      const metrics: Record<string, Record<string, any>> = {};
      for (const [stepper, count] of stepperCounts.entries()) {
        metrics[stepper] = { count };
      }
      return { items, metrics };
    }
  }
];

export default class LogicStepper extends AStepper implements IHasCycles {
  steppers: AStepper[] = [];
  private runner: FlowRunner;
  private sources: IObservationSource[] = [...builtInSources];

  async setWorld(world: TWorld, steppers: AStepper[]) {
    this.world = world;
    this.steppers = steppers;
    this.runner = new FlowRunner(world, steppers);

    // Collect observation sources from other steppers
    for (const stepper of steppers) {
      // Check if stepper implements IHasCycles (duck typing as runtime check)
      if ('cycles' in stepper) {
        const hasCycles = stepper as unknown as IHasCycles;
        const concerns = hasCycles.cycles.getConcerns?.();
        if (concerns?.sources) {
          this.sources.push(...concerns.sources);
        }
      }
    }
  }

  cycles: IStepperCycles = {
    getConcerns: () => ({
      sources: builtInSources
    })
  };

  private getSource(name: string): IObservationSource | undefined {
    return this.sources.find(s => s.name.toLowerCase() === name.toLowerCase());
  }

  private stripQuotes(text: string): string {
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('`') && text.endsWith('`'))) {
      return text.slice(1, -1);
    }
    return text;
  }

  /**
   * Get values and metrics for iteration - handles both domains and observation sources.
   * Syntax: "in {domain}" or "observed in {source}"
   */
  private getIterationValues(phrase: string): { values: string[], metrics?: Record<string, Record<string, any>>, error?: string } {
    // Check for "observed in {source}" pattern
    const observedMatch = phrase.match(/^observed in (.+)$/i);
    if (observedMatch) {
      const sourceName = observedMatch[1].trim();
      const source = this.getSource(sourceName);
      if (!source) return { values: [], error: `Unknown observation source: "${sourceName}"` };
      const { items, metrics } = source.observe(this.getWorld());
      return { values: items, metrics };
    }

    // Otherwise treat as domain name
    const domainName = this.stripQuotes(phrase);
    const result = this.getWorld().shared.getDomainValues(domainName);
    return { values: (result.values as string[]) || [], error: result.error };
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
        statements = this.stripQuotes(statements);
        const statementList = statements.split(',').map(s => s.trim());
        for (const statement of statementList) {
          const res = await this.runner.runStatements([statement], { intent: { mode: 'speculative' }, parentStep: featureStep });
          if (res.kind === 'ok') return OK;
          this.getWorld().eventLogger.debug(`any of: statement "${statement}" failed: ${res.message}`);
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
    // Supports both: "in {domain}" and "observed in {source}"
    // -------------------------------------------------------------------------

    // EXISTENTIAL: Exists x in D such that P(x)
    // some x in Domain is ...
    // some x observed in step usage is ...
    some: {
      match: /^some (.*?) (in|observed in) (.*?) is (.*)/,
      action: async (_: unknown, featureStep: TFeatureStep): Promise<TActionResult> => {
        const match = featureStep.in.match(/^some (.*?) (in|observed in) (.*?) is (.*)/);
        if (!match) return actionNotOK('some: invalid syntax');
        const [, what, connector, sourceOrDomain, statementStr] = match;

        const phrase = connector === 'observed in' ? `observed in ${sourceOrDomain}` : sourceOrDomain;
        const { values, metrics, error } = this.getIterationValues(phrase);
        if (error) return actionNotOK(error);

        if (values.length === 0) return actionNotOK(`No members in "${sourceOrDomain}" to check`);

        const mode = 'speculative';
        let found = false;

        for (const val of values) {
          this.getWorld().shared.set(
            { term: what, value: String(val), domain: 'string', origin: Origin.var },
            { in: featureStep.in, seq: featureStep.seqPath, when: 'quantifier' }
          );

          // Set metric variables if from observation source
          if (metrics?.[val]) {
            for (const [metricKey, metricValue] of Object.entries(metrics[val])) {
              const domain = typeof metricValue === 'number' ? 'number' : 'string';
              this.getWorld().shared.set(
                { term: `${sanitizeKey(val)}/${metricKey}`, value: String(metricValue), domain, origin: Origin.var },
                { in: featureStep.in, seq: featureStep.seqPath, when: 'observation' }
              );
            }
          }

          const res = await this.runner.runStatements([statementStr], { intent: { mode }, parentStep: featureStep });
          if (res.kind === 'ok') {
            found = true;
            break;
          }
        }
        return found ? OK : actionNotOK(`No ${what} in ${sourceOrDomain} satisfied the condition`);
      }
    },

    // UNIVERSAL: For All x in D, P(x)
    // every x in Domain is ...
    // every x observed in step usage is ...
    every: {
      match: /^every (.*?) (in|observed in) (.*?) is (.*)/,
      action: async (_: unknown, featureStep: TFeatureStep): Promise<TActionResult> => {
        const match = featureStep.in.match(/^every (.*?) (in|observed in) (.*?) is (.*)/);
        if (!match) return actionNotOK('every: invalid syntax');
        const [, what, connector, sourceOrDomain, statementStr] = match;

        const phrase = connector === 'observed in' ? `observed in ${sourceOrDomain}` : sourceOrDomain;
        const { values, metrics, error } = this.getIterationValues(phrase);
        if (error) return actionNotOK(error);

        if (values.length === 0) return OK;

        const mode = featureStep.intent?.mode === 'speculative' ? 'speculative' : 'authoritative';

        for (const val of values) {
          this.getWorld().shared.set(
            { term: what, value: String(val), domain: 'string', origin: Origin.var },
            { in: featureStep.in, seq: featureStep.seqPath, when: 'quantifier' }
          );

          // Set metric variables if from observation source
          if (metrics?.[val]) {
            for (const [metricKey, metricValue] of Object.entries(metrics[val])) {
              const domain = typeof metricValue === 'number' ? 'number' : 'string';
              this.getWorld().shared.set(
                { term: `${sanitizeKey(val)}/${metricKey}`, value: String(metricValue), domain, origin: Origin.var },
                { in: featureStep.in, seq: featureStep.seqPath, when: 'observation' }
              );
            }
          }

          const res = await this.runner.runStatements([statementStr], { intent: { mode }, parentStep: featureStep });
          if (res.kind !== 'ok') {
            return actionNotOK(`Universal check failed for value "${val}": ${res.message}`);
          }
        }
        return OK;
      }
    },
  } satisfies TStepperSteps;

}
