import { AStepper, TStepperSteps } from '../lib/astepper.js';
import { TActionResult, TStepArgs, TFeatureStep, OK, TWorld, IStepperCycles, TStepperStep } from '../lib/defs.js';
import { executeSubFeatureSteps, findFeatureStepsFromStatement } from '../lib/util/featureStep-executor.js';
import { ExecMode } from '../lib/defs.js';
import { actionOK, actionNotOK } from '../lib/util/index.js';
import { DOMAIN_STATEMENT } from '../lib/domain-types.js';
import { EExecutionMessageType, TMessageContext } from '../lib/interfaces/logger.js';


type TActivitiesFixedSteps = {
	activity: TStepperStep;
	remember: TStepperStep;
	ensure: TStepperStep;
	forget: TStepperStep;
	showOutcomes: TStepperStep;
};

type TActivitiesStepperSteps = TStepperSteps & TActivitiesFixedSteps;

/**
 * Stepper that dynamically builds virtual steps from `remember` statements.
 */
export class ActivitiesStepper extends AStepper {
	private steppers: AStepper[] = [];
	// Track which outcome patterns were defined in backgrounds vs features
	private backgroundOutcomePatterns: Set<string> = new Set();
	private featureOutcomePatterns: Set<string> = new Set();

	private readonly baseSteps = {
		activity: {
			gwta: 'Activity: {activity}',
			virtual: true,
			action: async () => Promise.resolve(OK),
		},

		remember: {
			gwta: 'remember {outcome} with {proof}',
			virtual: true,
			resolveFeatureLine: (line: string, path: string, stepper: AStepper) => {
				const activitiesStepper = stepper as ActivitiesStepper;
				const rememberMatch = line.match(/^remember\s+(.+?)\s+with\s+(.+?)(?:\s+forgets\s+(.+))?$/i);
				if (rememberMatch) {
					const outcome = rememberMatch[1].trim();
					const proofStatement = rememberMatch[2].trim();
					const forgets = rememberMatch[3]?.trim();
					const isBackground = path.includes('.background');
					activitiesStepper.registerOutcome(outcome, [proofStatement], path, forgets, isBackground);
					return true; // Skip normal step resolution
				}
				return false;
			},
			action: async () => Promise.resolve(OK), // Never called during execution since resolved
		},

		ensure: {
			description: 'Ensure an outcome is satisfied, executing its recipe if not already cached',
			gwta: `ensure {outcome:${DOMAIN_STATEMENT}}`,
			virtual: true,
			action: async ({ outcome }: { outcome: TFeatureStep[] }, featureStep: TFeatureStep) => {
				// Build cache key from the resolved outcome steps
				const outcomeKey = outcome.map(step => step.in).join(' ');
				this.getWorld().logger.debug(`ensure: requesting outcome "${outcomeKey}"`);

				// Check if already satisfied (cached)
				const satisfiedOutcomes = this.getWorld().runtime.satisfiedOutcomes;
				if (satisfiedOutcomes[outcomeKey]) {
					this.getWorld().logger.debug(`ensure: outcome "${outcomeKey}" already satisfied (cached)`);
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
					const messageContext: TMessageContext = {
						incident: EExecutionMessageType.ACTION,
						incidentDetails: { outcome: outcomeKey, error: result }
					};
					return actionNotOK(`ensure: outcome "${outcomeKey}" could not be satisfied`, { messageContext });
				}

				// Cache the satisfied outcome with its proof result
				satisfiedOutcomes[outcomeKey] = {
					proofResult: result
				};

				this.getWorld().logger.debug(`ensure: cached outcome "${outcomeKey}"`);

				const messageContext: TMessageContext = { incident: EExecutionMessageType.ACTION, incidentDetails: { outcome: outcomeKey, satisfied: true } };
				return actionOK({ messageContext });
			},
		},

		forget: {
			description: 'Forget (invalidate) a previously satisfied outcome, forcing it to re-execute on next ensure',
			gwta: 'forget {outcome}',
			virtual: true,
			action: ({ outcome }: { outcome: string }) => {
				this.getWorld().logger.debug(`forget: invalidating outcome "${outcome}"`);

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
					this.getWorld().logger.debug(`forget: removed ${count} cached instances of "${outcome}"`);
				} else {
					this.getWorld().logger.debug(`forget: outcome "${outcome}" was not cached`);
				}

				const messageContext: TMessageContext = { incident: EExecutionMessageType.ACTION, incidentDetails: { outcome, forgotten: true } };
				return actionOK({ messageContext });
			},
		},

		showOutcomes: {
			exact: 'show outcomes',
			virtual: true,
			action: () => {
				const satisfied = this.getWorld().runtime.satisfiedOutcomes;
				const allOutcomes: Record<string, { satisfied?: { in: string; seqPath: number[] }[] }> = {};

				for (const outcomePattern in this.steps) {
					if (!this.steps[outcomePattern].virtual) {
						const instances = [];
						const patternPrefix = outcomePattern.split('{')[0].trim();

						for (const satisfiedKey in satisfied) {
							if (satisfiedKey.startsWith(patternPrefix) || satisfiedKey === outcomePattern) {
								instances.push({
									in: satisfiedKey,
									seqPath: satisfied[satisfiedKey].proofResult.seqPath.join(',')
								});
							}
						}

						allOutcomes[outcomePattern] = instances.length > 0 ? { satisfied: instances } : {};
					}
				}

				this.getWorld().logger.info(`Outcomes (${Object.keys(allOutcomes).length} registered, ${Object.keys(satisfied).length} satisfied):\n${JSON.stringify(allOutcomes, null, 2)}`);
				return actionOK({ messageContext: { incident: EExecutionMessageType.ACTION, incidentDetails: { outcomes: allOutcomes } } });
			},
		},
	} as const satisfies TActivitiesFixedSteps;

	readonly typedSteps = this.baseSteps;

	steps: TActivitiesStepperSteps = { ...this.baseSteps };

	cycles: IStepperCycles = {
		startFeature: () => {
			this.getWorld().runtime.satisfiedOutcomes = {};
		},
		endFeature: async () => {
			// Remove feature-scoped outcome steps (so they're not available to next feature)
			for (const pattern of this.featureOutcomePatterns) {
				delete this.steps[pattern];
			}
			this.featureOutcomePatterns.clear();
			return Promise.resolve();
		}
	}
	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
	}

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
	 * @param isBackground - Whether this outcome is defined in a background (persists across features)
	 */
	registerOutcome(outcome: string, proofStatements: string[], proofPath: string, forgets?: string, isBackground?: boolean) {
		// Prevent duplicate outcome registration
		if (this.steps[outcome]) {
			throw new Error(`Outcome "${outcome}" is already registered. Each outcome can only be defined once.`);
		}

		// Track whether this is a background or feature outcome
		if (isBackground) {
			this.backgroundOutcomePatterns.add(outcome);
		} else {
			this.featureOutcomePatterns.add(outcome);
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
						this.getWorld(),
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
