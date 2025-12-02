import { AStepper, IHasCycles, TStepperSteps } from '../lib/astepper.js';

import { TActionResult, TStepArgs, TFeatureStep, OK, TWorld, IStepperCycles, TStepperStep, TFeatures, CycleWhen } from '../lib/defs.js';
import { actionOK, actionNotOK, getActionable } from '../lib/util/index.js';
import { DOMAIN_STATEMENT } from '../lib/domain-types.js';
import { EExecutionMessageType, TMessageContext } from '../lib/interfaces/logger.js';
import { FlowRunner } from '../lib/core/flow-runner.js';

// need this type because some steps are virtual
type TActivitiesFixedSteps = {
	activity: TStepperStep;
	waypoint: TStepperStep;
	waypointLabel: TStepperStep;
	ensure: TStepperStep;
	showWaypoints: TStepperStep;
};

type TActivitiesStepperSteps = TStepperSteps & TActivitiesFixedSteps;

/**
 * Stepper that dynamically builds virtual steps from `waypoint` statements.
 * implements this logic: P ∨ (¬P ∧ [A]P)
 */
export class ActivitiesStepper extends AStepper implements IHasCycles {
	private runner: FlowRunner;
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
			precludes: ['ActivitiesStepper.waypointLabel'],
			resolveFeatureLine: (line: string, path: string, _stepper: AStepper, _backgrounds: TFeatures, allLines?: string[], lineIndex?: number) => {
				return this.resolveWaypointCommon(line, path, allLines, lineIndex, true);
			},
			action: async ({ proof }: { proof: TFeatureStep[] }, featureStep: TFeatureStep) => {
				this.getWorld().logger.debug(`waypoint action: executing ${proof?.length || 0} proof steps`);

				try {
					const result = await this.runner.runSteps(proof, { intent: { mode: 'authoritative' }, parentStep: featureStep });
					if (result.kind !== 'ok') {
						return actionNotOK(`waypoint: failed to execute proof steps: ${result.message}`);
					}
					return actionOK();
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					this.getWorld().logger.debug(`waypoint action: exception executing proof steps: ${msg}`);
					return actionNotOK(`waypoint: failed to execute proof steps: ${msg}`);
				}
			},
		},

		waypointLabel: {
			gwta: `waypoint {outcome}`,
			resolveFeatureLine: (line: string, path: string, _stepper: AStepper, _backgrounds: TFeatures, allLines?: string[], lineIndex?: number) => {
				return this.resolveWaypointCommon(line, path, allLines, lineIndex, false);
			},
			action: async () => actionOK(),
		},

		ensure: {
			description: 'Ensure a waypoint condition by always running the proof. If proof passes, waypoint is already satisfied. If proof fails, run the full activity, then try the proof again',
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
					return actionNotOK(`ensure: "${outcomeKey}" is not a registered waypoint. ensure can only be used with waypoints.`);
				}

				const metadata = this.registeredOutcomeMetadata.get(pattern);
				if (!metadata || metadata.proofStatements.length === 0) {
					return actionNotOK(`ensure: waypoint "${outcomeKey}" has no proof. ensure can only be used with waypoints that have a proof.`);
				}

				let proofStatements: string[] | undefined;

				try {
					// Use FlowRunner for the proof execution
					const flowResult = await this.runner.runSteps(outcome, { intent: { mode: 'authoritative', usage: featureStep.intent?.usage, stepperOptions: { isEnsure: true } }, parentStep: featureStep });

					if (flowResult.kind !== 'ok') {
						// Log ENSURE_END for failure
						const endMessageContext: TMessageContext = {
							incident: EExecutionMessageType.ENSURE_END,
							incidentDetails: { waypoint: outcomeKey, satisfied: false, error: flowResult.message, actionResult: { ok: false } }
						};
						this.getWorld().logger.log(`❌ Failed ensuring ${outcomeKey}`, endMessageContext);

						const messageContext: TMessageContext = {
							incident: EExecutionMessageType.ACTION,
							incidentDetails: { waypoint: outcomeKey, satisfied: false, error: flowResult.message }
						};
						return actionNotOK(`ensure: waypoint "${outcomeKey}" proof failed: ${flowResult.message}`, { messageContext });
					}

					proofStatements = flowResult.payload?.messageContext?.incidentDetails?.proofStatements;

					if (!proofStatements) {
						return actionNotOK(`ensure: waypoint "${outcomeKey}" succeeded but returned no proofStatements`);
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

				// FIXME: We don't have easy access to proofStatements from FlowRunner result yet unless we pass them back
				// For now, we assume if it passed, it passed.

				this.ensuredInstances.set(outcomeKey, { proof: proofStatements, valid: true });

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
						// Use FlowRunner to run the proof statements directly
						const result = await this.runner.runStatements(instanceData.proof, { intent: { mode: 'speculative' }, parentStep: featureStep });

						waypointResults[instanceKey] = {
							proof: instanceData.proof.join('; '),
							currentlyValid: result.kind === 'ok'
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
		this.runner = new FlowRunner(world, steppers);
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

				// 1. Check Proof (Speculative)
				if (proofStatements.length > 0) {
					const proof = await this.runner.runStatements(proofStatements, { args: args as Record<string, string>, intent: { mode: 'speculative' }, parentStep: featureStep });

					if (proof.kind === 'ok') {
						this.getWorld().logger.debug(`ActivitiesStepper: proof passed for outcome "${outcome}", skipping activity body`);
						return actionOK({
							messageContext: {
								incident: EExecutionMessageType.ACTION,
								incidentDetails: { proofStatements, proofSatisfied: true }
							}
						});
					}
				}

				// 2. Proof Failed or Missing
				if (!featureStep.intent?.stepperOptions?.isEnsure) {
					if (proofStatements.length > 0) {
						return actionNotOK(`ActivitiesStepper: proof failed for outcome "${outcome}"`);
					}
					// No proof (waypointLabel) and not ensure: do nothing.
					return actionOK();
				}

				// 3. Ensure Mode: Run Activity Body
				if (activityBlockSteps && activityBlockSteps.length > 0) {
					this.getWorld().logger.debug(`ActivitiesStepper: proof failed for outcome "${outcome}", running activity body`);

					const act = await this.runner.runStatements(activityBlockSteps, { args: args as Record<string, string>, intent: { mode: 'authoritative', usage: featureStep.intent?.usage }, parentStep: featureStep });
					if (act.kind !== 'ok') {
						return actionNotOK(`ActivitiesStepper: activity body failed for outcome "${outcome}": ${act.message}`);
					}

					// 4. Verify Proof After Activity
					this.getWorld().logger.debug(`ActivitiesStepper: verifying proof after activity body for outcome "${outcome}"`);
					if (proofStatements.length > 0) {
						const verify = await this.runner.runStatements(proofStatements, { args: args as Record<string, string>, intent: { mode: 'authoritative', usage: featureStep.intent?.usage }, parentStep: featureStep });
						if (verify.kind !== 'ok') {
							return actionNotOK(`ActivitiesStepper: proof verification failed after activity body for outcome "${outcome}": ${verify.message}`);
						}
					}

					return actionOK({
						messageContext: {
							incident: EExecutionMessageType.ACTION,
							incidentDetails: { proofStatements }
						}
					});
				} else {
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

	private resolveWaypointCommon(line: string, path: string, allLines: string[] | undefined, lineIndex: number | undefined, requireProof: boolean): boolean {
		if (!line.match(/^waypoint\s+/i)) {
			return false;
		}

		let outcome: string;
		let proofStatements: string[] = [];

		if (requireProof) {
			if (!line.match(/^waypoint\s+.+?\s+with\s+/i)) {
				return false;
			}
			const match = line.match(/^waypoint\s+(.+?)\s+with\s+(.+?)$/i);
			if (!match) return false;
			outcome = match[1].trim();
			const proofRaw = match[2].trim();
			proofStatements = proofRaw.split('\n').map(s => s.trim()).filter(s => s.length > 0);
		} else {
			if (line.match(/^waypoint\s+.+?\s+with\s+/i)) {
				return false;
			}
			const match = line.match(/^waypoint\s+(.+?)$/i);
			if (!match) return false;
			outcome = match[1].trim();
		}

		// Skip if already registered (prevents infinite loops)
		if (this.backgroundOutcomePatterns.has(outcome) || this.featureOutcomePatterns.has(outcome)) {
			return true;
		}

		const isBackground = path.includes('backgrounds/');

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

		this.registerOutcome(outcome, proofStatements, path, isBackground, activityBlockSteps);
		return true;
	}
}

export default ActivitiesStepper;
