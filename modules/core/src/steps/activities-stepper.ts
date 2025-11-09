import { AStepper, TStepperSteps } from '../lib/astepper.js';
import { TActionResult, TStepArgs, TFeatureStep, OK, TWorld, IStepperCycles, TStepperStep, TFeatures } from '../lib/defs.js';
import { executeSubFeatureSteps, findFeatureStepsFromStatement } from '../lib/util/featureStep-executor.js';
import { ExecMode } from '../lib/defs.js';
import { actionOK, actionNotOK, getActionable } from '../lib/util/index.js';
import { DOMAIN_STATEMENT } from '../lib/domain-types.js';
import { EExecutionMessageType, TMessageContext } from '../lib/interfaces/logger.js';


type TActivitiesFixedSteps = {
	activity: TStepperStep;
	remember: TStepperStep;
	ensure: TStepperStep;
	forget: TStepperStep;
	remembered: TStepperStep;
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
			action: async () => Promise.resolve(OK),
		},

		remember: {
			gwta: `remember {outcome} with {proof:${DOMAIN_STATEMENT}}`,
			resolveFeatureLine: (line: string, path: string, stepper: AStepper, _backgrounds: TFeatures, allLines?: string[], lineIndex?: number) => {
				// Simple regex match to check if this is a remember statement
				if (!line.match(/^remember\s+.+?\s+with\s+/i)) {
					return false;
				}

				const activitiesStepper = stepper as ActivitiesStepper;

				// Extract outcome name
				const match = line.match(/^remember\s+(.+?)\s+with\s+(.+?)$/i);
				if (!match) {
					return false;
				}

				const outcome = match[1].trim();

				// Skip if this outcome pattern is already registered
				// This prevents infinite loops if resolveFeatureLine is called multiple times
				if (activitiesStepper.backgroundOutcomePatterns.has(outcome) || activitiesStepper.featureOutcomePatterns.has(outcome)) {
					return true;
				}

				const isBackground = path.includes('backgrounds/');
				const proofRaw = match[2].trim();

				// Parse the proof statements from the remember clause (DOMAIN_STATEMENT)
				const proofFromRemember = proofRaw
					.split(/\\n|\n/)
					.map(s => s.trim())
					.filter(s => s.length > 0);

				// Check if we're in an activity block by scanning backwards through allLines
				let activityBlockSteps: string[] | undefined;

				if (allLines && lineIndex !== undefined) {
					// Scan backwards from current line to find the Activity: marker
					let activityStartLine = -1;
					for (let i = lineIndex - 1; i >= 0; i--) {
						const prevLine = getActionable(allLines[i]);
						if (prevLine.match(/^Activity:/i)) {
							activityStartLine = i;
							break;
						}
						// Stop if we hit another major section marker
						if (prevLine.match(/^(Feature|Scenario|Background):/i)) {
							break;
						}
					}

					if (activityStartLine !== -1) {
						// Collect ALL steps in the activity block up to (but not including) the current remember statement
						const blockLines: string[] = [];
						for (let i = activityStartLine + 1; i < lineIndex; i++) {
							const stepLine = getActionable(allLines[i]);
							if (stepLine) {
								blockLines.push(stepLine);
							}
						}
						activityBlockSteps = blockLines;
					}
				}

				// Register the outcome with its proof from the DOMAIN_STATEMENT
				activitiesStepper.registerOutcome(outcome, proofFromRemember, path, isBackground, activityBlockSteps);
				return true; // Skip normal step resolution since we've registered the outcome
			},
			action: async ({ proof }: { proof: TFeatureStep[] }, featureStep: TFeatureStep) => {
				// Execute the proof statements to satisfy this outcome
				this.getWorld().logger.debug(`remember action: executing ${proof?.length || 0} proof steps`);

				const result = await executeSubFeatureSteps(
					featureStep,
					proof,
					this.steppers,
					this.getWorld(),
					ExecMode.WITH_CYCLES
				);

				if (!result.ok) {
					return actionNotOK(`remember: failed to execute proof steps`);
				}

				return actionOK();
			},
		},

		ensure: {
			description: 'Ensure an outcome is satisfied, executing its recipe if not already cached',
			gwta: `ensure {outcome:${DOMAIN_STATEMENT}}`,
			action: async ({ outcome }: { outcome: TFeatureStep[] }, featureStep: TFeatureStep) => {
				// Build cache key from the resolved outcome steps
				const outcomeKey = outcome.map(step => step.in).join(' ');
				this.getWorld().logger.debug(`ensure: requesting outcome "${outcomeKey}"`);

				const satisfiedOutcomes = this.getWorld().runtime.satisfiedOutcomes;

				// Check if already satisfied (cached)
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
		}, forget: {
			description: 'Forget (invalidate) a previously satisfied outcome, forcing it to re-execute on next ensure',
			gwta: `forget {outcome:${DOMAIN_STATEMENT}}`,
			action: ({ outcome }: { outcome: TFeatureStep[] }, featureStep: TFeatureStep) => {
				// Build the outcome key from the resolved outcome steps (same as ensure)
				const outcomeKey = outcome.map(step => step.in).join(' ');
				this.getWorld().logger.debug(`forget: invalidating outcome "${outcomeKey}" (from ${featureStep.in})`);

				// Delete only the exact matching entry
				if (this.getWorld().runtime.satisfiedOutcomes[outcomeKey]) {
					delete this.getWorld().runtime.satisfiedOutcomes[outcomeKey];
					this.getWorld().logger.debug(`forget: removed cached outcome "${outcomeKey}"`);
				} else {
					this.getWorld().logger.debug(`forget: outcome "${outcomeKey}" was not cached`);
				}

				const messageContext: TMessageContext = { incident: EExecutionMessageType.ACTION, incidentDetails: { outcome: outcomeKey, forgotten: true } };
				return actionOK({ messageContext });
			},
		},

		remembered: {
			description: 'Check if an outcome is already cached/satisfied',
			gwta: `remembered {outcome:${DOMAIN_STATEMENT}}`,
			action: ({ outcome }: { outcome: TFeatureStep[] }) => {
				const outcomeKey = outcome.map(step => step.in).join(' ');
				const satisfied = this.getWorld().runtime.satisfiedOutcomes;

				if (satisfied[outcomeKey]) {
					this.getWorld().logger.debug(`remembered: outcome "${outcomeKey}" is cached`);
					const messageContext: TMessageContext = { incident: EExecutionMessageType.ACTION, incidentDetails: { outcome: outcomeKey, remembered: true } };
					return actionOK({ messageContext });
				} else {
					return actionNotOK(`outcome "${outcomeKey}" is not remembered`);
				}
			},
		},

		showOutcomes: {
			exact: 'show outcomes',
			action: () => {
				const satisfied = this.getWorld().runtime.satisfiedOutcomes;
				const allOutcomes: Record<string, { satisfied?: { in: string }[] }> = {};

				for (const outcomePattern in this.steps) {
					// Only show virtual (registered outcome) steps, not built-in steps like ensure, forget
					if (this.steps[outcomePattern].virtual) {
						const instances = [];

						for (const satisfiedKey in satisfied) {
							if (satisfiedKey === outcomePattern) {
								instances.push({
									in: satisfiedKey
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

	/**
	 * Register a dynamic outcome step.
	 * This is called when parsing `remember` statements.
	 *
	 * @param outcome - The outcome pattern (e.g., "Is logged in as {user}")
	 * @param proofStatements - Array of statement strings from the DOMAIN_STATEMENT proof
	 * @param proofPath - The path of the feature containing the proof
	 * @param isBackground - Whether this outcome is defined in a background (persists across features)
	 * @param activityBlockSteps - Optional array of all steps in the containing activity block
	 */
	registerOutcome(outcome: string, proofStatements: string[], proofPath: string, isBackground?: boolean, activityBlockSteps?: string[]) {
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

		this.getWorld().logger.info(`ActivitiesStepper: registerOutcome called with ${proofStatements.length} proof steps for "${outcome}"`);

		// Determine which statements to execute: activity block if available and non-empty, otherwise proof statements
		const statementsToExecute = (activityBlockSteps && activityBlockSteps.length > 0) ? activityBlockSteps : proofStatements;

		this.steps[outcome] = {
			gwta: outcome,
			virtual: true,  // Dynamically registered outcomes are virtual
			description: `Outcome: ${outcome}. Proof: ${proofStatements.join('; ')}`,
			action: async (args: TStepArgs, featureStep: TFeatureStep): Promise<TActionResult> => {
				this.getWorld().logger.debug(`ActivitiesStepper: executing recipe for outcome "${outcome}" with args ${JSON.stringify(args)}`);

				// Expand variables in the statements using the matched args
				const expandedStatements = statementsToExecute.map(statement => {
					let expanded = statement;
					for (const [key, value] of Object.entries(args)) {
						expanded = expanded.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
					}
					return expanded;
				});				// Re-resolve the statements in the current execution context
				const resolvedProofSteps: TFeatureStep[] = [];
				for (let i = 0; i < expandedStatements.length; i++) {
					const statement = expandedStatements[i];
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
