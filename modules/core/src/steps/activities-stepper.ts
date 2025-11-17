import { AStepper, IHasCycles, TStepperSteps } from '../lib/astepper.js';

import { TActionResult, TStepArgs, TFeatureStep, OK, TWorld, IStepperCycles, TStepperStep, TFeatures, CycleWhen } from '../lib/defs.js';
import { executeSubFeatureSteps, findFeatureStepsFromStatement } from '../lib/util/featureStep-executor.js';
import { ExecMode } from '../lib/defs.js';
import { actionOK, actionNotOK, getActionable } from '../lib/util/index.js';
import { DOMAIN_STATEMENT } from '../lib/domain-types.js';
import { EExecutionMessageType, TMessageContext } from '../lib/interfaces/logger.js';

// need this type because some steps are virtual
type TActivitiesFixedSteps = {
	activity: TStepperStep;
	waypoint: TStepperStep;
	ensure: TStepperStep;
	waypointed: TStepperStep;
	showWaypoints: TStepperStep;
};

type TActivitiesStepperSteps = TStepperSteps & TActivitiesFixedSteps;

/**
 * Stepper that dynamically builds virtual steps from `waypoint` statements.
 * implements this logic: P ∨ (¬P ∧ [A]P)
 */
export class ActivitiesStepper extends AStepper implements IHasCycles {


	private steppers: AStepper[] = [];
	// Track which outcome patterns were defined in backgrounds vs features
	private backgroundOutcomePatterns: Set<string> = new Set();
	private featureOutcomePatterns: Set<string> = new Set();
	// Track which feature each feature-scoped outcome belongs to (for proper cleanup)
	private outcomeToFeaturePath: Map<string, string> = new Map();
	// Track the currently running feature path
	private currentFeaturePath: string = '';
	// Track the last feature path to clear outcomes from it when starting a new feature
	private lastFeaturePath: string = '';
	// Track ensured waypoint instances with their interpolated proofs
	private ensuredInstances: Map<string, { proof: string[]; valid: boolean }> = new Map();
	// Track registered outcome metadata for runtime re-emission to the monitor
	private registeredOutcomeMetadata: Map<string, { proofStatements: string[]; proofPath: string; isBackground: boolean; activityBlockSteps?: string[] }> = new Map();

	cycles: IStepperCycles = {
		startExecution: () => {
			this.sendGraphLinkMessages();
		},
		startFeature: (startFeature) => {
			this.getWorld().logger.debug(`ActivitiesStepper.startFeature: starting feature at path "${startFeature.resolvedFeature.path}"`);

			// If we were running a different feature before, clear its outcomes
			if (this.lastFeaturePath && this.lastFeaturePath !== startFeature.resolvedFeature.path) {
				this.getWorld().logger.debug(`ActivitiesStepper.startFeature: clearing outcomes from previous feature "${this.lastFeaturePath}"`);
				const outcomesToClear: string[] = [];
				for (const [outcome, featurePath] of this.outcomeToFeaturePath.entries()) {
					if (featurePath === this.lastFeaturePath) {
						outcomesToClear.push(outcome);
						delete this.steps[outcome];
						this.featureOutcomePatterns.delete(outcome);
					}
				}
				for (const outcome of outcomesToClear) {
					this.outcomeToFeaturePath.delete(outcome);
				}
				this.getWorld().logger.debug(`ActivitiesStepper.startFeature: cleared ${outcomesToClear.length} outcomes from previous feature`);
			}

			this.currentFeaturePath = startFeature.resolvedFeature.path;
			this.sendGraphLinkMessages();
		},
		endFeature: () => {
			// Track this feature path so we can clean it up when the next feature starts
			this.lastFeaturePath = this.currentFeaturePath;
			// Clear ensured instances for next feature
			this.ensuredInstances.clear();
			return Promise.resolve();
		}
	}
	cyclesWhen = {
		startExecution: CycleWhen.FIRST,
		startFeature: CycleWhen.FIRST,
	}

	private readonly baseSteps = {
		activity: {
			gwta: 'Activity: {activity}',
			action: () => OK
		},

		waypoint: {
			gwta: `waypoint {outcome} with {proof:${DOMAIN_STATEMENT}}`,
			resolveFeatureLine: (line: string, path: string, stepper: AStepper, _backgrounds: TFeatures, allLines?: string[], lineIndex?: number) => {
				// Simple regex match to check if this is a waypoint statement
				if (!line.match(/^waypoint\s+.+?\s+with\s+/i)) {
					return false;
				}

				const activitiesStepper = stepper as ActivitiesStepper;

				// Extract outcome name
				const match = line.match(/^waypoint\s+(.+?)\s+with\s+(.+?)$/i);
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

				// Parse the proof statements from the waypoint clause (DOMAIN_STATEMENT)
				const proofFromRemember = proofRaw.split('\n').map(s => s.trim()).filter(s => s.length > 0);

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
						// Collect ALL steps in the activity block up to and including the current waypoint statement
						const blockLines: string[] = [];
						for (let i = activityStartLine + 1; i < lineIndex; i++) {  // Use < instead of <= to exclude waypoint line
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
				this.getWorld().logger.debug(`waypoint action: executing ${proof?.length || 0} proof steps`);

				const result = await executeSubFeatureSteps(featureStep, proof, this.steppers, this.getWorld(), ExecMode.NO_CYCLES);

				if (!result.ok) {
					return actionNotOK(`waypoint: failed to execute proof steps`);
				}

				return actionOK();
			},
		},

		ensure: {
			description: 'Ensure a waypoint condition by always running the proof. If proof passes, waypoint is already satisfied. If proof fails, run the full activity to satisfy it.',
			gwta: `ensure {outcome:${DOMAIN_STATEMENT}}`,
			action: async ({ outcome }: { outcome: TFeatureStep[] }, featureStep: TFeatureStep) => {
				// Build outcome key from the resolved outcome steps
				const outcomeKey = outcome.map(step => step.in).join(' ');
				this.getWorld().logger.debug(`ensure: verifying waypoint "${outcomeKey}"`);

				// Get the pattern from the first outcome step's action
				const pattern = outcome[0]?.action?.actionName || outcomeKey;

				// Get the registered waypoint to access its proof
				const registeredWaypoint = this.steps[pattern];
				if (!registeredWaypoint) {
					const messageContext: TMessageContext = {
						incident: EExecutionMessageType.ACTION,
						incidentDetails: { waypoint: outcomeKey, error: 'waypoint not registered' }
					};
					return actionNotOK(`ensure: waypoint "${outcomeKey}" (pattern "${pattern}") is not registered`, { messageContext });
				}

				const result = await executeSubFeatureSteps(featureStep, outcome, this.steppers, this.getWorld(), ExecMode.NO_CYCLES);

				if (!result.ok) {
					const messageContext: TMessageContext = {
						incident: EExecutionMessageType.ACTION,
						incidentDetails: { waypoint: outcomeKey, satisfied: false, error: result }
					};
					return actionNotOK(`ensure: waypoint "${outcomeKey}" could not be satisfied`, { messageContext });
				}

				// Extract the interpolated proof statements from the result
				const proofStatements = (result.stepActionResult?.messageContext?.incidentDetails as { proofStatements?: string[] })?.proofStatements;

				// Track this ensured instance
				if (proofStatements) {
					this.ensuredInstances.set(outcomeKey, { proof: proofStatements, valid: true });
				}

				this.getWorld().logger.debug(`ensure: waypoint "${outcomeKey}" verified and satisfied`);

				const messageContext: TMessageContext = {
					incident: EExecutionMessageType.ACTION,
					incidentDetails: {
						waypoint: outcomeKey,
						satisfied: true,
						proofStatements
					}
				};
				return actionOK({ messageContext });
			},
		},
		waypointed: {
			description: 'Deprecated: waypointed is no longer meaningful since outcomes are not cached',
			gwta: `waypointed {outcome:${DOMAIN_STATEMENT}}`,
			action: ({ outcome }: { outcome: TFeatureStep[] }) => {
				const outcomeKey = outcome.map(step => step.in).join(' ');
				this.getWorld().logger.debug(`waypointed: deprecated for outcome "${outcomeKey}". Outcomes are verified on each ensure, not cached.`);

				const messageContext: TMessageContext = { incident: EExecutionMessageType.ACTION, incidentDetails: { outcome: outcomeKey, deprecated: true } };
				return actionOK({ messageContext });
			},
		},

		showWaypoints: {
			exact: 'show waypoints',
			action: async (_args, featureStep: TFeatureStep) => {
				// Show ensured waypoint instances with their current validity
				const waypointResults: Record<string, {
					proof: string;
					currentlyValid: boolean;
					error?: string;
				}> = {};

				// Check validity of all ensured instances
				for (const [instanceKey, instanceData] of this.ensuredInstances.entries()) {
					this.getWorld().logger.debug(`show waypoints: verifying "${instanceKey}"`);
					try {
						// Re-verify the proof for this instance
						const resolvedSteps: TFeatureStep[] = [];

						for (let i = 0; i < instanceData.proof.length; i++) {
							const statement = instanceData.proof[i];
							const resolved = findFeatureStepsFromStatement(
								statement,
								this.steppers,
								this.getWorld(),
								featureStep.path,
								[...featureStep.seqPath, i],
								1
							);
							// Add waypoint context to each proof step
							const contextualizedSteps = resolved.map(step => ({
								...step,
								in: `[${instanceKey} proof] ${step.in}`
							}));
							resolvedSteps.push(...contextualizedSteps);
						}

						// Execute the proof statements with NO_CYCLES to check current validity
						const result = await executeSubFeatureSteps(featureStep, resolvedSteps, this.steppers, this.getWorld(), ExecMode.NO_CYCLES);

						waypointResults[instanceKey] = {
							proof: instanceData.proof.join('; '),
							currentlyValid: result.ok
						};
					} catch (error) {
						waypointResults[instanceKey] = {
							proof: instanceData.proof.join('; '),
							currentlyValid: false,
							error: error instanceof Error ? error.message : String(error)
						};
					}
				}

				this.getWorld().logger.info(`Waypoints (${Object.keys(waypointResults).length} ensured):\n${JSON.stringify(waypointResults, null, 2)}`);
				return actionOK({ messageContext: { incident: EExecutionMessageType.ACTION, incidentDetails: { waypoints: waypointResults } } });
			},
		},
	} as const satisfies TActivitiesFixedSteps;

	readonly typedSteps = this.baseSteps;

	steps: TActivitiesStepperSteps = { ...this.baseSteps };

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
	}

	/**
	 * Register a dynamic outcome step.
	 * This is called when parsing `waypoint` statements.
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

		// Store metadata for runtime re-emission via TEST_LINKS messages
		this.registeredOutcomeMetadata.set(outcome, {
			proofStatements,
			proofPath,
			isBackground: isBackground ?? false,
			activityBlockSteps: activityBlockSteps ?? [],
		});

		// Track whether this is a background or feature outcome
		if (isBackground) {
			this.backgroundOutcomePatterns.add(outcome);
		} else {
			this.featureOutcomePatterns.add(outcome);
			// Track which feature this outcome belongs to
			this.outcomeToFeaturePath.set(outcome, proofPath);
		}

		this.getWorld().logger.debug(`ActivitiesStepper: registerOutcome called with ${proofStatements.length} proof steps for "${outcome}"`);
		this.getWorld().logger.debug(`ActivitiesStepper: outcome is background=${isBackground}, will be added to ${isBackground ? 'backgroundOutcomePatterns' : 'featureOutcomePatterns'}`);

		// Store proofStatements for later retrieval
		const outcomeProofStatements = proofStatements;

		this.steps[outcome] = {
			gwta: outcome,
			virtual: true,  // Dynamically registered outcomes are virtual
			description: `Outcome: ${outcome}. Proof: ${proofStatements.join('; ')}`,
			action: async (args: TStepArgs, featureStep: TFeatureStep): Promise<TActionResult> => {
				this.getWorld().logger.debug(`ActivitiesStepper: executing recipe for outcome "${outcome}" with args ${JSON.stringify(args)}`);

				// Helper to expand variables in statements
				const expandStatements = (statements: string[]) => statements.map(statement => {
					let expanded = statement;
					for (const [key, value] of Object.entries(args)) {
						expanded = expanded.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
					}
					return expanded;
				});

				// Helper to resolve and execute statements
				const resolveAndExecute = async (statements: string[], stepOffset: number = 0, execMode: ExecMode = ExecMode.NO_CYCLES) => {
					const expandedStatements = expandStatements(statements);
					const resolvedSteps: TFeatureStep[] = [];
					for (let i = 0; i < expandedStatements.length; i++) {
						const statement = expandedStatements[i];
						this.getWorld().logger.debug(`ActivitiesStepper: resolving statement ${i}: "${statement}"`);
						const resolved = findFeatureStepsFromStatement(
							statement,
							this.steppers,
							this.getWorld(),
							proofPath,
							[...featureStep.seqPath, stepOffset + i],
							1
						);
						resolvedSteps.push(...resolved);
					}
					return await executeSubFeatureSteps(featureStep, resolvedSteps, this.steppers, this.getWorld(), execMode);
				};

				// ALWAYS-VERIFY SEMANTICS: Try proof first
				this.getWorld().logger.debug(`ActivitiesStepper: checking proof for outcome "${outcome}"`);
				this.getWorld().logger.debug(`ActivitiesStepper: proof statements: ${JSON.stringify(proofStatements)}`);
				const proofResult = await resolveAndExecute(proofStatements, 0, ExecMode.NO_CYCLES);

				// If proof passes, we're done (waypoint already satisfied)
				if (proofResult.ok) {
					this.getWorld().logger.debug(`ActivitiesStepper: proof passed for outcome "${outcome}", skipping activity body`);
					const interpolatedProof = expandStatements(outcomeProofStatements);
					return actionOK({
						messageContext: {
							incident: EExecutionMessageType.ACTION,
							incidentDetails: { proofStatements: interpolatedProof, proofSatisfied: true }
						}
					});
				}

				// Proof failed - execute activity body (WITHOUT waypoint line), then verify proof
				// Flow: 1) Execute activity body steps, 2) Execute proof to verify, 3) Success or fail
				if (activityBlockSteps && activityBlockSteps.length > 0) {
					this.getWorld().logger.debug(`ActivitiesStepper: proof failed for outcome "${outcome}", running activity body`);

					// Step 1: Execute activity body (does NOT include the waypoint line to avoid recursion)
					// Use WITH_CYCLES so that activity body steps can trigger hooks
					const activityResult = await resolveAndExecute(activityBlockSteps, 100, ExecMode.WITH_CYCLES);

					if (!activityResult.ok) {
						return actionNotOK(`ActivitiesStepper: activity body failed for outcome "${outcome}"`);
					}

					// Step 2: Activity body succeeded - now verify the proof passes
					this.getWorld().logger.debug(`ActivitiesStepper: verifying proof after activity body for outcome "${outcome}"`);
					const verifyResult = await resolveAndExecute(proofStatements, 200, ExecMode.NO_CYCLES);

					if (!verifyResult.ok) {
						return actionNotOK(`ActivitiesStepper: proof verification failed after activity body for outcome "${outcome}"`);
					}

					// Step 3: Success - proof now passes
					const interpolatedProof = expandStatements(outcomeProofStatements);
					return actionOK({
						messageContext: {
							incident: EExecutionMessageType.ACTION,
							incidentDetails: { proofStatements: interpolatedProof }
						}
					});
				} else {
					// No activity body, just proof - and it failed
					return actionNotOK(`ActivitiesStepper: proof failed and no activity body available for outcome "${outcome}"`);
				}
			}
		};

		this.getWorld().logger.debug(`ActivitiesStepper: registered outcome pattern "${outcome}" with ${proofStatements.length} proof steps`);
	}

	/**
	 * Send all GRAPH_LINK messages that were emitted during resolution.
	 * This is needed because MonitorHandler subscribes AFTER resolution happens,
	 * so it misses the initial GRAPH_LINK messages. We store them during resolution
	 * and retransmit when requested (e.g., when MonitorHandler first subscribes).
	 */
	sendGraphLinkMessages(): void {
		for (const [outcome, metadata] of this.registeredOutcomeMetadata.entries()) {
			const messageContext: TMessageContext = {
				incident: EExecutionMessageType.GRAPH_LINK,
				incidentDetails: {
					outcome,
					proofStatements: metadata.proofStatements,
					proofPath: metadata.proofPath,
					isBackground: metadata.isBackground,
					activityBlockSteps: metadata.activityBlockSteps ?? null,
				}
			};
			this.getWorld().logger.debug(`waypoint registered: "${outcome}"`, messageContext);
		}
	}
}

export default ActivitiesStepper;
