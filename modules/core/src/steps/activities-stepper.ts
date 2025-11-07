import { AStepper } from '../lib/astepper.js';
import { TStepperSteps } from '../lib/astepper.js';
import { TActionResult, TStepArgs, TFeatureStep, OK, TWorld } from '../lib/defs.js';
import { executeSubFeatureSteps, findFeatureStepsFromStatement } from '../lib/util/featureStep-executor.js';
import { ExecMode } from '../lib/defs.js';
import { actionOK, actionNotOK } from '../lib/util/index.js';
import { DOMAIN_STATEMENT } from '../lib/domain-types.js';
import { EExecutionMessageType, TMessageContext } from '../lib/interfaces/logger.js';


/**
 * Virtual stepper that dynamically builds steps from `remember` statements.
 * During pre-Resolve phase, this stepper is populated with outcome patterns
 * extracted from all `remember {outcome} with {proof}` statements in features.
 *
 * When `ensure {outcome}` is called, it will match against these patterns via
 * normal GWTA resolution, check if already cached, and execute the recipe if needed.
 */
export class ActivitiesStepper extends AStepper {
  private steppers: AStepper[] = [];

  async setWorld(world: TWorld, steppers: AStepper[]) {
    await super.setWorld(world, steppers);
    this.steppers = steppers;
  }

  steps: TStepperSteps = {
    activity: {
      gwta: 'Activity: {activity}',
      action: async () => Promise.resolve(OK),
    },

    ensure: {
      description: 'Ensure an outcome is satisfied, executing its recipe if not already cached',
      gwta: `ensure {outcome:${DOMAIN_STATEMENT}}`,
      action: async ({ outcome }: { outcome: TFeatureStep[] }, featureStep: TFeatureStep) => {
        // Build cache key from the resolved outcome steps
        const outcomeKey = outcome.map(step => step.in).join(' ');
        this.world?.logger.debug(`ensure: requesting outcome "${outcomeKey}"`);

        // Check if already satisfied (cached)
        const satisfiedOutcomes = this.getWorld().runtime.satisfiedOutcomes;
        if (satisfiedOutcomes[outcomeKey]) {
          this.world?.logger.debug(`ensure: outcome "${outcomeKey}" already satisfied (cached)`);
          const messageContext: TMessageContext = { incident: EExecutionMessageType.ACTION, incidentDetails: { outcome: outcomeKey, cached: true } };
          return actionOK({ messageContext });
        }

        // Execute the outcome steps
        const result = await executeSubFeatureSteps(
          featureStep,
          outcome,
          this.steppers,
          this.getWorld(),
          ExecMode.WITH_CYCLES
        );

        if (!result.ok) {
          return actionNotOK(`ensure: outcome "${outcomeKey}" could not be satisfied`);
        }

        // Cache the satisfied outcome with its proof result
        satisfiedOutcomes[outcomeKey] = {
          proofResult: result
        };
        this.world?.logger.debug(`ensure: cached outcome "${outcomeKey}"`);

        const messageContext: TMessageContext = { incident: EExecutionMessageType.ACTION, incidentDetails: { outcome: outcomeKey, satisfied: true } };
        return actionOK({ messageContext });
      },
    },

    forget: {
      description: 'Forget (invalidate) a previously satisfied outcome, forcing it to re-execute on next ensure',
      gwta: 'forget {outcome}',
      action: ({ outcome }: { outcome: string }) => {
        this.world?.logger.debug(`forget: invalidating outcome "${outcome}"`);

        const satisfied = this.getWorld().runtime.satisfiedOutcomes;

        // Delete entries where the key matches or starts with the outcome pattern
        let count = 0;
        for (const key in satisfied) {
          // Direct match or pattern match (e.g., "Created {item}" matches "Created Widget1")
          if (key === outcome || key.startsWith(outcome.split('{')[0])) {
            delete satisfied[key];
            count++;
          }
        }

        if (count > 0) {
          this.world?.logger.debug(`forget: removed ${count} cached instances of "${outcome}"`);
        } else {
          this.world?.logger.debug(`forget: outcome "${outcome}" was not cached`);
        }

        const messageContext: TMessageContext = { incident: EExecutionMessageType.ACTION, incidentDetails: { outcome, forgotten: true } };
        return actionOK({ messageContext });
      },
    },
  };

  // Track which outcomes cause other outcomes to be forgotten
  // Key: outcome pattern, Value: array of outcome patterns to forget
  forgetsMap: Record<string, string[]> = {};

  /**
   * Register an outcome pattern with its proof steps.
   * This is called when parsing `remember` statements.
   *
   * @param outcome - The outcome pattern (e.g., "Is logged in as {user}")
   * @param proofStatements - Array of statement strings that prove this outcome
   * @param proofPath - The path of the feature containing the proof
   * @param forgets - Optional outcome pattern that this outcome forgets
   */
  registerOutcome(outcome: string, proofStatements: string[], proofPath: string, forgets?: string) {
    // Prevent duplicate outcome registration
    if (this.steps[outcome]) {
      throw new Error(`Outcome "${outcome}" is already registered. Each outcome can only be defined once.`);
    }

    // Store forgets relationship if provided
    if (forgets) {
      this.forgetsMap[outcome] = [forgets];
    }

    this.getWorld().logger.info(`ActivitiesStepper: registerOutcome called with ${proofStatements.length} steps for "${outcome}"`);

    this.steps[outcome] = {
      gwta: outcome,
      description: `Outcome: ${outcome}. Proof: ${proofStatements.join('; ')}`,
      action: async (args: TStepArgs, featureStep: TFeatureStep): Promise<TActionResult> => {
        this.getWorld().logger.debug(`ActivitiesStepper: executing recipe for outcome "${outcome}" with args ${JSON.stringify(args)}`);

        // If this outcome forgets other outcomes, handle that first
        if (this.forgetsMap[outcome]) {
          const satisfied = this.getWorld().runtime.satisfiedOutcomes;

          for (const forgottenOutcome of this.forgetsMap[outcome]) {
            // Build the forgotten key the same way ensure builds it: from resolved step.in
            // We need to resolve the forgotten outcome with the same args
            let forgottenKey = forgottenOutcome;

            // Replace placeholders with their values as they appear in featureStep.in
            // The args values already have quotes if they were quoted in the input
            for (const [key, value] of Object.entries(args)) {
              // Need to add quotes back since args are unquoted
              const quotedValue = typeof value === 'string' ? `"${value}"` : String(value);
              forgottenKey = forgottenKey.replace(new RegExp(`\\{${key}\\}`, 'g'), quotedValue);
            }

            // Delete the matching cache entry
            if (satisfied[forgottenKey]) {
              delete satisfied[forgottenKey];
              this.getWorld().logger.debug(`ActivitiesStepper: auto-forgot "${forgottenKey}" due to forgets clause`);
            }
          }
        }

        // Expand variables in proof statements using the matched args
        const expandedProofStatements = proofStatements.map(statement => {
          let expanded = statement;
          for (const [key, value] of Object.entries(args)) {
            expanded = expanded.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
          }
          return expanded;
        });

        // Re-resolve the proof statements in the current execution context
        const resolvedProofSteps: TFeatureStep[] = [];
        for (let i = 0; i < expandedProofStatements.length; i++) {
          const statement = expandedProofStatements[i];
          this.getWorld().logger.debug(`ActivitiesStepper: resolving proof statement ${i}: "${statement}"`);
          const resolved = findFeatureStepsFromStatement(
            statement,
            this.steppers,
            this.world,
            proofPath,
            [...featureStep.seqPath, i],
            1
          );
          resolvedProofSteps.push(...resolved);
        }

        // Execute the re-resolved proof steps
        const result = await executeSubFeatureSteps(featureStep, resolvedProofSteps, this.steppers, this.getWorld(), ExecMode.WITH_CYCLES);

        if (!result.ok) {
          return actionNotOK(`ActivitiesStepper: failed to satisfy outcome "${outcome}"`);
        }

        return actionOK();
      }
    };

    this.getWorld().logger.info(`ActivitiesStepper: registered outcome pattern "${outcome}" with ${proofStatements.length} proof steps`);
  }
}

export default ActivitiesStepper;
