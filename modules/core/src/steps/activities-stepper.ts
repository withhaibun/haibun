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
	showWaypoints: TStepperStep;
};

type TActivitiesStepperSteps = TStepperSteps & TActivitiesFixedSteps;

/**
 * Stepper that dynamically builds virtual steps from `waypoint` statements.
 * implements this logic: P ∨ (¬P ∧ [A]P)
 */
export class ActivitiesStepper extends AStepper implements IHasCycles {
	private steppers: AStepper[] = [];
	private backgroundOutcomePatterns: Set<string> = new Set();
	private featureOutcomePatterns: Set<string> = new Set();
	private outcomeToFeaturePath: Map<string, string> = new Map();
	private currentFeaturePath: string = '';
	private lastFeaturePath: string = '';
	private ensuredInstances: Map<string, { proof: string[]; valid: boolean }> = new Map();
	private ensureAttempts: Map<string, number> = new Map();
	private registeredOutcomeMetadata: Map<string, { proofStatements: string[]; proofPath: string; isBackground: boolean; activityBlockSteps?: string[] }> = new Map();

	cycles: IStepperCycles = {
		startExecution: () => {
			this.sendGraphLinkMessages();
		},
		startFeature: (startFeature) => {
			this.getWorld().logger.debug(`ActivitiesStepper.startFeature: starting feature at path "${startFeature.resolvedFeature.path}"`);

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
			this.lastFeaturePath = this.currentFeaturePath;
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
				if (!line.match(/^waypoint\s+.+?\s+with\s+/i)) {
					return false;
				}

				const activitiesStepper = stepper as ActivitiesStepper;

				const match = line.match(/^waypoint\s+(.+?)\s+with\s+(.+?)$/i);
				if (!match) {
					return false;
				}

				const outcome = match[1].trim();

				// Skip if already registered (prevents infinite loops)
				if (activitiesStepper.backgroundOutcomePatterns.has(outcome) || activitiesStepper.featureOutcomePatterns.has(outcome)) {
					return true;
				}

				const isBackground = path.includes('backgrounds/');
				const proofRaw = match[2].trim();

				const proofFromRemember = proofRaw.split('\n').map(s => s.trim()).filter(s => s.length > 0);

				// Scan backwards to find containing Activity block
				let activityBlockSteps: string[] | undefined;

				if (allLines && lineIndex !== undefined) {
					let activityStartLine = -1;
					for (let i = lineIndex - 1; i >= 0; i--) {
						const prevLine = getActionable(allLines[i]);
						if (prevLine.match(/^Activity:/i)) {
							activityStartLine = i;
							break;
						}
						if (prevLine.match(/^(Feature|Scenario|Background):/i)) {
							break;
						}
					}

					if (activityStartLine !== -1) {
						// Collect steps between Activity: and waypoint (excluding waypoint itself)
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

				activitiesStepper.registerOutcome(outcome, proofFromRemember, path, isBackground, activityBlockSteps);

				return true;
			},
			action: async ({ proof }: { proof: TFeatureStep[] }, featureStep: TFeatureStep) => {
				this.getWorld().logger.debug(`waypoint action: executing ${proof?.length || 0} proof steps`);

				try {
					const result = await executeSubFeatureSteps(featureStep, proof, this.steppers, this.getWorld(), ExecMode.NO_CYCLES);
					if (!result.ok) {
						return actionNotOK(`waypoint: failed to execute proof steps`);
					}
					return actionOK();
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					this.getWorld().logger.debug(`waypoint action: exception executing proof steps: ${msg}`);
					return actionNotOK(`waypoint: failed to execute proof steps: ${msg}`);
				}
			},
		},

		ensure: {
			description: 'Ensure a waypoint condition by always running the proof. If proof passes, waypoint is already satisfied. If proof fails, run the full activity to satisfy it.',
			gwta: `ensure {outcome:${DOMAIN_STATEMENT}}`,
			action: async ({ outcome }: { outcome: TFeatureStep[] }, featureStep: TFeatureStep) => {
				const outcomeKey = outcome.map(step => step.in).join(' ');

				// Guard: prevent infinite ensure retry loops by counting attempts per outcome+seq
				const attemptKey = outcomeKey; // key by outcome only to avoid differing seqPaths
				const prevAttempts = this.ensureAttempts.get(attemptKey) ?? 0;
				const MAX_ENSURE_ATTEMPTS = 10;
				this.ensureAttempts.set(attemptKey, prevAttempts + 1);
				if (prevAttempts + 1 > MAX_ENSURE_ATTEMPTS) {
					this.getWorld().logger.warn(`ensure: exceeded max attempts (${MAX_ENSURE_ATTEMPTS}) for ${outcomeKey}`);
					if (this.getWorld().runtime) {
						this.getWorld().runtime.exhaustionError = 'ensure max attempts exceeded';
					}
					const messageContext: TMessageContext = {
						incident: EExecutionMessageType.ACTION,
						incidentDetails: { waypoint: outcomeKey, satisfied: false, error: 'max ensure attempts exceeded', terminal: true }
					};
					return actionNotOK(`ensure: max attempts exceeded for waypoint "${outcomeKey}"`, { messageContext });
				}

				// Log ENSURE_START
				const startMessageContext: TMessageContext = {
					incident: EExecutionMessageType.ENSURE_START,
					incidentDetails: { waypoint: outcomeKey, step: featureStep }
				};
				this.getWorld().logger.log(`⏳ Ensuring ${outcomeKey}`, startMessageContext);

				this.getWorld().logger.debug(`ensure: verifying waypoint "${outcomeKey}"`);

				const pattern = outcome[0]?.action?.actionName || outcomeKey;

				const registeredWaypoint = this.steps[pattern];
				if (!registeredWaypoint) {
					const messageContext: TMessageContext = {
						incident: EExecutionMessageType.ACTION,
						incidentDetails: { waypoint: outcomeKey, error: 'waypoint not registered' }
					};
					return actionNotOK(`ensure: waypoint "${outcomeKey}" (pattern "${pattern}") is not registered`, { messageContext });
				}

				let result;
				try {
					result = await executeSubFeatureSteps(featureStep, outcome, this.steppers, this.getWorld(), ExecMode.NO_CYCLES);
					if (!result.ok) {
						// Log ENSURE_END for failure
						const endMessageContext: TMessageContext = {
							incident: EExecutionMessageType.ENSURE_END,
							incidentDetails: { waypoint: outcomeKey, satisfied: false, error: result, actionResult: { ok: false } }
						};
						this.getWorld().logger.log(`❌ Failed ensuring ${outcomeKey}`, endMessageContext);

						const messageContext: TMessageContext = {
							incident: EExecutionMessageType.ACTION,
							incidentDetails: { waypoint: outcomeKey, satisfied: false, error: result }
						};
						return actionNotOK(`ensure: waypoint "${outcomeKey}" proof failed`, { messageContext });
					}
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					this.getWorld().logger.debug(`ensure: exception while executing proof for ${outcomeKey}: ${msg}`);
					const messageContext: TMessageContext = {
						incident: EExecutionMessageType.ACTION,
						incidentDetails: { waypoint: outcomeKey, satisfied: false, error: msg }
					};
					return actionNotOK(`ensure: waypoint "${outcomeKey}" proof execution error: ${msg}`, { messageContext });
				}

				const proofStatements = (result.stepActionResult?.messageContext?.incidentDetails as { proofStatements?: string[] })?.proofStatements;

				if (proofStatements) {
					this.ensuredInstances.set(outcomeKey, { proof: proofStatements, valid: true });
				}

				// On success or after one ensure action completes, reset attempt counter for this outcome
				this.ensureAttempts.delete(attemptKey);

				this.getWorld().logger.debug(`ensure: waypoint "${outcomeKey}" verified and satisfied`);

				// Log ENSURE_END for success at trace level (just to hide the ENSURE_START)
				const endMessageContext: TMessageContext = {
					incident: EExecutionMessageType.ENSURE_END,
					incidentDetails: { waypoint: outcomeKey, satisfied: true, proofStatements, actionResult: { ok: true } }
				};
				this.getWorld().logger.trace(`✓ Ensured ${outcomeKey}`, endMessageContext);

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
		showWaypoints: {
			exact: 'show waypoints',
			action: async (_args, featureStep: TFeatureStep) => {
				const waypointResults: Record<string, {
					proof: string;
					currentlyValid: boolean;
					error?: string;
				}> = {};

				for (const [instanceKey, instanceData] of this.ensuredInstances.entries()) {
					this.getWorld().logger.debug(`show waypoints: verifying "${instanceKey}"`);
					try {
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
							const contextualizedSteps = resolved.map(step => ({
								...step,
								in: `[${instanceKey} proof] ${step.in}`
							}));
							resolvedSteps.push(...contextualizedSteps);
						}

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

				// Interpolate args into statements (e.g., {user} -> "admin")
				const expandStatements = (statements: string[]) => statements.map(statement => {
					let expanded = statement;
					for (const [key, value] of Object.entries(args)) {
						const escKey = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
						const regex = new RegExp(`\\{\\s*${escKey}\\s*\\}`, 'g');
						expanded = expanded.replace(regex, String(value));
					}
					return expanded;
				});

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

				// ALWAYS-VERIFY: Try proof first (P ∨ (¬P ∧ [A]P) semantics)
				let proofResult;
				try {
					proofResult = await resolveAndExecute(proofStatements, 0, ExecMode.NO_CYCLES);
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
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					this.getWorld().logger.debug(`ActivitiesStepper: exception while executing proof for outcome "${outcome}": ${msg}`);
					return actionNotOK(`ActivitiesStepper: proof execution error: ${msg}`);
				}

				// Proof failed - run activity body, then verify proof passes
				if (activityBlockSteps && activityBlockSteps.length > 0) {
					this.getWorld().logger.debug(`ActivitiesStepper: proof failed for outcome "${outcome}", running activity body`);

					// Execute activity steps (WITH_CYCLES to allow hooks)
					let activityResult;
					try {
						activityResult = await resolveAndExecute(activityBlockSteps, 100, ExecMode.WITH_CYCLES);
						if (!activityResult.ok) {
							return actionNotOK(`ActivitiesStepper: activity body failed for outcome "${outcome}"`);
						}
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						this.getWorld().logger.debug(`ActivitiesStepper: exception while executing activity for outcome "${outcome}": ${msg}`);
						return actionNotOK(`ActivitiesStepper: activity execution error: ${msg}`);
					}

					// Verify proof now passes after running activity
					this.getWorld().logger.debug(`ActivitiesStepper: verifying proof after activity body for outcome "${outcome}"`);
					let verifyResult;
					try {
						verifyResult = await resolveAndExecute(proofStatements, 200, ExecMode.NO_CYCLES);
						if (!verifyResult.ok) {
							return actionNotOK(`ActivitiesStepper: proof verification failed after activity body for outcome "${outcome}"`);
						}
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						this.getWorld().logger.debug(`ActivitiesStepper: exception while verifying proof after activity for outcome "${outcome}": ${msg}`);
						return actionNotOK(`ActivitiesStepper: proof verification error after activity: ${msg}`);
					}

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
	 * Re-emit GRAPH_LINK messages for waypoint metadata.
	 * MonitorHandler subscribes after resolution, so we retransmit stored metadata.
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
