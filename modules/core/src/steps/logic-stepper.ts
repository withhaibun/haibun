import { AStepper, TStepperSteps } from '../lib/astepper.js';
import { OK, TFeatureStep, TWorld, ExecMode, Origin, TProvenanceIdentifier, TActionResult } from '../lib/defs.js';
import { actionNotOK, sleep } from '../lib/util/index.js';
import { executeSubFeatureSteps, findFeatureStepsFromStatement } from '../lib/util/featureStep-executor.js';
import { DOMAIN_STATEMENT, normalizeDomainKey } from '../lib/domain-types.js';
import { TAnyFixme } from '../lib/fixme.js';

export default class LogicStepper extends AStepper {
  steppers: AStepper[] = [];

  async setWorld(world: TWorld, steppers: AStepper[]) {
    await super.setWorld(world, steppers);
    this.steppers = steppers;
  }

  steps = {
    // -------------------------------------------------------------------------
    // CONTROL FLOW (The Gates)
    // -------------------------------------------------------------------------

    // RECURRENCE: While(Condition) { Action }
    whenever: {
      gwta: 'whenever {condition}, {action}',
      action: async ({ condition, action }: { condition: TFeatureStep[], action: TFeatureStep[] }, featureStep: TFeatureStep): Promise<TActionResult> => {
        const world = this.getWorld();
        let loopCount = 0;
        const MAX_LOOPS = 1000;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (loopCount++ > MAX_LOOPS) return actionNotOK('whenever: infinite loop detected');

          // Check Guard (No Side Effects)
          const check = await executeSubFeatureSteps(featureStep, condition, this.steppers, world, ExecMode.NO_CYCLES, -1);

          // If Guard is false, break the loop (Success)
          if (!check.ok) break;

          // Execute Action
          const result = await executeSubFeatureSteps(featureStep, action, this.steppers, world, ExecMode.WITH_CYCLES, loopCount);

          // If Action fails, bubble up the error
          if (!result.ok) {
            return result.stepActionResult || actionNotOK('whenever: action failed without result');
          }
          await sleep(0);
        }
        return OK;
      }
    },

    // IMPLICATION: If P then Q
    where: {
      gwta: 'where {condition}, {action}',
      action: async ({ condition, action }: { condition: TFeatureStep[], action: TFeatureStep[] }, featureStep: TFeatureStep): Promise<TActionResult> => {
        // Check Antecedent
        const check = await executeSubFeatureSteps(featureStep, condition, this.steppers, this.getWorld(), ExecMode.NO_CYCLES, -1);

        // Vacuously true if condition is false
        if (!check.ok) return OK;

        // Check Consequent
        const result = await executeSubFeatureSteps(featureStep, action, this.steppers, this.getWorld(), ExecMode.WITH_CYCLES, 1);

        return result.ok ? OK : (result.stepActionResult || actionNotOK('Constraint failed: Condition was true, but Action failed.'));
      }
    },

    // DISJUNCTION: A or B or C
    anyOf: {
      gwta: 'any of {statements:${DOMAIN_STATEMENT}}',
      action: async ({ statements }: { statements: TFeatureStep[] }, featureStep: TFeatureStep): Promise<TActionResult> => {
        for (const statement of statements) {
          const res = await executeSubFeatureSteps(featureStep, [statement], this.steppers, this.getWorld(), ExecMode.NO_CYCLES);
          if (res.ok) return OK;
        }
        return actionNotOK('No conditions in the list were satisfied');
      }
    },

    // NEGATION: Not P
    not: {
      gwta: `not {statements:${DOMAIN_STATEMENT}}`,
      action: async ({ statements }: { statements: TFeatureStep[] }, featureStep: TFeatureStep): Promise<TActionResult> => {
        const lastResult = await executeSubFeatureSteps(featureStep, statements, this.steppers, this.getWorld(), ExecMode.NO_CYCLES, -1);
        return lastResult.ok ? actionNotOK('not statement was true (failed negation)') : OK;
      },
    },

    // -------------------------------------------------------------------------
    // QUANTIFIERS (The Iterators)
    // -------------------------------------------------------------------------

    // EXISTENTIAL: Exists x in D such that P(x)
    some: {
      gwta: 'some {variable} in {domain} is {check}',
      action: async ({ variable, domain, check }: { variable: string, domain: string, check: TFeatureStep[] }, featureStep: TFeatureStep): Promise<TActionResult> => {
        const domainKey = normalizeDomainKey(domain);
        const domainDef = this.getWorld().domains[domainKey];

        if (!domainDef || !Array.isArray(domainDef.values)) {
          return actionNotOK(`Domain "${domain}" is not an enumerable set`);
        }

        const originalValue = this.getVarValue(variable);
        let found = false;

        try {
          for (const val of domainDef.values) {
            this.setVarValue(variable, val, domainKey, featureStep);

            // Interpolate and Check
            const expandedCheck = this.expandCheckWithVariable(check, variable, val);
            const res = await executeSubFeatureSteps(featureStep, expandedCheck, this.steppers, this.getWorld(), ExecMode.NO_CYCLES);

            if (res.ok) {
              found = true;
              break;
            }
          }
        } finally {
          this.restoreVarValue(variable, originalValue, domainKey, featureStep);
        }

        return found ? OK : actionNotOK(`No ${variable} in ${domain} satisfied the condition`);
      }
    },

    // UNIVERSAL: For All x in D, P(x)
    every: {
      gwta: 'every {variable} in {domain} is {check}',
      action: async ({ variable, domain, check }: { variable: string, domain: string, check: TFeatureStep[] }, featureStep: TFeatureStep): Promise<TActionResult> => {
        const domainKey = normalizeDomainKey(domain);
        const domainDef = this.getWorld().domains[domainKey];

        if (!domainDef || !Array.isArray(domainDef.values)) {
          return actionNotOK(`Domain "${domain}" is not an enumerable set`);
        }

        const originalValue = this.getVarValue(variable);

        try {
          for (const val of domainDef.values) {
            this.setVarValue(variable, val, domainKey, featureStep);

            const expandedCheck = this.expandCheckWithVariable(check, variable, val);
            const res = await executeSubFeatureSteps(featureStep, expandedCheck, this.steppers, this.getWorld(), ExecMode.NO_CYCLES);

            if (!res.ok) {
              return actionNotOK(`Universal check failed for value "${val}"`);
            }
          }
        } finally {
          this.restoreVarValue(variable, originalValue, domainKey, featureStep);
        }
        return OK;
      }
    },
  } satisfies TStepperSteps;

  // --- HELPERS ---

  private getVarValue(what: string): TAnyFixme {
    const envVal = this.getWorld().options.envVariables[what];
    return envVal !== undefined ? envVal : this.getWorld().shared.get(what);
  }

  private setVarValue(term: string, value: TAnyFixme, domain: string, featureStep: TFeatureStep) {
    this.getWorld().shared.set({ term, value, domain, origin: Origin.var }, this.provenance(featureStep));
  }

  private restoreVarValue(term: string, value: TAnyFixme, domain: string, featureStep: TFeatureStep) {
    if (value !== undefined) {
      this.setVarValue(term, value, domain, featureStep);
    } else {
      this.getWorld().shared.unset(term);
    }
  }

  private provenance(featureStep: TFeatureStep): TProvenanceIdentifier {
    return {
      in: featureStep.in,
      seq: featureStep.seqPath,
      when: `${featureStep.action.stepperName}.steps.${featureStep.action.actionName}`
    };
  }

  private expandCheckWithVariable(checkSteps: TFeatureStep[], variable: string, value: string): TFeatureStep[] {
    return checkSteps.map(step => {
      const original = step.in || '';
      const replaced = original.replace(new RegExp(`\\{${variable}\\}`, 'g'), value);
      const resolved = findFeatureStepsFromStatement(replaced, this.steppers, this.getWorld(), step.path, step.seqPath, 1);
      return resolved[0];
    });
  }
}
