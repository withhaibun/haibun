import { AStepper, IHasCycles, TStepperSteps } from '../lib/astepper.js';

import { TFeatureStep, TWorld, IStepperCycles, TStepperStep, TFeatures, CycleWhen, TStepInput } from '../lib/defs.js';
import { TActionResult, TStepArgs, OK, TOKStepActionResult } from '../schema/protocol.js';
import { actionOK, actionNotOK, getActionable, formatCurrentSeqPath } from '../lib/util/index.js';
import { DOMAIN_STATEMENT } from '../lib/domain-types.js';
import { FlowRunner } from '../lib/core/flow-runner.js';
import { ControlEvent, LifecycleEvent } from '../schema/protocol.js';

// need this type because some steps are dynamically generated (e.g. waypoints)
type TActivitiesFixedSteps = {
	activity: TStepperStep;
	waypointWithProof: TStepperStep;
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
	private featureSteps: Map<string, Record<string, TStepperStep>> = new Map();
	private currentFeaturePath: string = '';
	private lastFeaturePath: string = '';
	private lastResolutionPath: string = '';
	private ensuredInstances: Map<string, { proof: string[]; valid: boolean }> = new Map();
	private ensureAttempts: Map<string, number> = new Map();
	private registeredOutcomeMetadata: Map<string, { proofStatements: string[]; proofPath: string; isBackground: boolean; activityBlockSteps?: TStepInput[]; lineNumber?: number }> = new Map();
	private backgroundSteps: Record<string, TStepperStep> = {};
	private inActivityBlock = false;

	cycles: IStepperCycles = {
		startExecution: () => {
			this.sendGraphLinkMessages();
		},
		startFeature: (startFeature) => {
			if (this.lastFeaturePath && this.lastFeaturePath !== startFeature.resolvedFeature.path) {
				const previousSteps = this.featureSteps.get(this.lastFeaturePath);
				if (previousSteps) {
					for (const outcome of Object.keys(previousSteps)) {
						delete this.steps[outcome];
					}
				}
			}

			const currentSteps = this.featureSteps.get(startFeature.resolvedFeature.path);
			if (currentSteps) {
				for (const [outcome, step] of Object.entries(currentSteps)) {
					this.steps[outcome] = step;
				}
			}
			// Always reload background steps
			for (const [outcome, step] of Object.entries(this.backgroundSteps)) {
				this.steps[outcome] = step;
			}

			this.currentFeaturePath = startFeature.resolvedFeature.path;
			this.inActivityBlock = false;
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

	readonly baseSteps = {
		activity: {
			gwta: 'Activity: {activity}',
			action: () => OK,
			resolveFeatureLine: (line: string, path: string, _stepper: AStepper, _backgrounds: TFeatures, allLines?: string[], lineIndex?: number, actualSourcePath?: string) => {
				this.lastResolutionPath = path;

				if (line.match(/^Activity:/i)) {
					this.inActivityBlock = true;
					return true;
				}

				if (this.inActivityBlock) {
					if (line.match(/^(Feature|Scenario|Background|Activity):/i)) {
						this.inActivityBlock = false;
						return false;
					}

					if (line.match(/^waypoint\s+/i)) {
						// Use actualSourcePath for VSCode linking, path for registration
						this.resolveWaypointCommon(line, path, allLines, lineIndex, line.includes(' with '), actualSourcePath);

						let hasMoreWaypoints = false;
						if (allLines && lineIndex !== undefined) {
							for (let i = lineIndex + 1; i < allLines.length; i++) {
								const nextLine = (allLines[i] || '').trim();
								if (nextLine.match(/^(Feature|Scenario|Background|Activity):/i)) {
									break;
								}
								if (nextLine.match(/^waypoint\s+/i)) {
									hasMoreWaypoints = true;
									break;
								}
							}
						}

						if (!hasMoreWaypoints) {
							this.inActivityBlock = false;
						}

						return true;
					}

					return true;
				}

				return false;
			},
		},

		waypointWithProof: {
			gwta: `waypoint {outcome} with {proof:${DOMAIN_STATEMENT}}`,
			precludes: ['ActivitiesStepper.waypointLabel'],
			action: async ({ proof }: { proof: TFeatureStep[] }, featureStep: TFeatureStep) => {
				try {
					const result = await this.runner.runSteps(proof, { intent: { mode: 'authoritative' }, parentStep: featureStep });
					if (result.kind !== 'ok') {
						return actionNotOK(`waypoint: failed to execute proof steps: ${result.message}`);
					}
					return actionOK();
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					return actionNotOK(`waypoint: failed to execute proof steps: ${msg}`);
				}
			},
		},

		waypointLabel: {
			gwta: `waypoint {outcome}`,
			action: async () => actionOK(),
		},

		ensure: {
			description: 'Ensure a waypoint condition by always running the proof. If proof passes, waypoint is already satisfied. If proof fails, run the full activity, then try the proof again',
			gwta: `ensure {outcome:${DOMAIN_STATEMENT}}`,
			unique: true,
			action: async ({ outcome }: { outcome: TFeatureStep[] }, featureStep: TFeatureStep) => {
				const outcomeKey = outcome.map(step => step.in).join(' ');

				const attemptKey = outcomeKey;
				const prevAttempts = this.ensureAttempts.get(attemptKey) ?? 0;
				const MAX_ENSURE_ATTEMPTS = 10;
				this.ensureAttempts.set(attemptKey, prevAttempts + 1);
				if (prevAttempts + 1 > MAX_ENSURE_ATTEMPTS) {
					if (this.getWorld().runtime) {
						this.getWorld().runtime.exhaustionError = 'ensure max attempts exceeded';
					}
					return actionNotOK(`ensure: max attempts exceeded for waypoint "${outcomeKey}"`);
				}

				// Emit ensure start for monitors
				this.getWorld().eventLogger.emit(LifecycleEvent.parse({
					id: formatCurrentSeqPath(featureStep.seqPath) + '.ensure',
					timestamp: Date.now(),
					kind: 'lifecycle',
					completeness: 'full',
					type: 'ensure',
					stage: 'start',
					in: outcomeKey,
					lineNumber: featureStep.source.lineNumber,
					featurePath: featureStep.source.path,
					status: 'running',
				}));

				const pattern = outcome[0]?.action?.actionName || outcomeKey;

				const registeredWaypoint = this.steps[pattern];
				if (!registeredWaypoint) {
					this.emitEnsureEnd(featureStep, outcomeKey, false, `"${outcomeKey}" is not a registered waypoint`);
					return actionNotOK(`ensure: "${outcomeKey}" is not a registered waypoint. ensure can only be used with waypoints.`);
				}

				const metadata = this.registeredOutcomeMetadata.get(pattern);
				if (!metadata || metadata.proofStatements.length === 0) {
					this.emitEnsureEnd(featureStep, outcomeKey, false, 'no proof defined');
					return actionNotOK(`ensure: waypoint "${outcomeKey}" has no proof. ensure can only be used with waypoints that have a proof.`);
				}

				const activityArgs: Record<string, string> = {};
				for (const step of outcome) {
					if (step.action.stepValuesMap) {
						for (const [key, val] of Object.entries(step.action.stepValuesMap)) {
							const value = val.value !== undefined ? String(val.value) : val.term;
							if (value !== undefined) {
								activityArgs[key] = value;
							}
						}
					}
				}

				let proofStatements: string[] | undefined;

				try {
					const flowResult = await this.runner.runSteps(outcome, { intent: { mode: 'authoritative', usage: featureStep.intent?.usage, stepperOptions: { isEnsure: true } }, parentStep: featureStep });

					if (flowResult.kind !== 'ok') {
						this.emitEnsureEnd(featureStep, outcomeKey, false, flowResult.message);
						return actionNotOK(`ensure: waypoint "${outcomeKey}" proof failed: ${flowResult.message}`);
					}

					proofStatements = (flowResult.topics as TOKStepActionResult)?.topics?.proofStatements as string[] | undefined;

					if (!proofStatements) {
						this.emitEnsureEnd(featureStep, outcomeKey, false, 'no proofStatements returned');
						return actionNotOK(`ensure: waypoint "${outcomeKey}" succeeded but returned no proofStatements`);
					}

				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					this.emitEnsureEnd(featureStep, outcomeKey, false, msg);
					return actionNotOK(`ensure: waypoint "${outcomeKey}" proof execution error: ${msg}`);
				}

				this.ensuredInstances.set(outcomeKey, { proof: proofStatements, valid: true });
				this.ensureAttempts.delete(attemptKey);

				this.emitEnsureEnd(featureStep, outcomeKey, true);
				return actionOK();
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
					try {
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

				return actionOK();
			},
		},
	} as const satisfies TActivitiesFixedSteps;

	readonly typedSteps = this.baseSteps;

	steps: TActivitiesStepperSteps = { ...this.baseSteps };

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.runner = new FlowRunner(world, steppers);
	}

	private emitEnsureEnd(featureStep: TFeatureStep, outcomeKey: string, ok: boolean, error?: string): void {
		this.getWorld().eventLogger.emit(LifecycleEvent.parse({
			id: formatCurrentSeqPath(featureStep.seqPath) + '.ensure',
			timestamp: Date.now(),
			kind: 'lifecycle',
			completeness: 'full',
			type: 'ensure',
			stage: 'end',
			in: outcomeKey,
			lineNumber: featureStep.source.lineNumber,
			featurePath: featureStep.source.path,
			status: ok ? 'completed' : 'failed',
			error,
		}));
	}

	registerOutcome(outcome: string, proofStatements: string[], proofPath: string, isBackground?: boolean, activityBlockSteps?: (string | TStepInput)[], lineNumber?: number, actualSourcePath?: string) {
		if (this.steps[outcome]) {
			const existing = this.steps[outcome];
			if (existing.source?.path === (actualSourcePath || proofPath) && existing.source?.lineNumber === lineNumber) {
				return;
			}
			throw new Error(`Outcome "${outcome}" is already registered. Each outcome can only be defined once. (Existing: ${existing.source?.path}:${existing.source?.lineNumber}, New: ${actualSourcePath || proofPath}:${lineNumber})`);
		}

		// Normalize activity steps and proofs to ensure they carry source location
		const sourcePath = actualSourcePath || proofPath;
		const normalizedActivitySteps: TStepInput[] = activityBlockSteps?.map(s => {
			return typeof s === 'string' ? { in: s, source: { path: sourcePath } } : s;
		}) ?? [];

		const normalizedProofSteps: TStepInput[] = proofStatements.map(s => ({
			in: s,
			source: { path: sourcePath }
		}));

		this.registeredOutcomeMetadata.set(outcome, {
			proofStatements,
			proofPath,
			isBackground: isBackground ?? false,
			activityBlockSteps: normalizedActivitySteps,
			lineNumber,
		});



		if (isBackground) {
			this.backgroundOutcomePatterns.add(outcome);
		} else {
			this.featureOutcomePatterns.add(outcome);
			this.outcomeToFeaturePath.set(outcome, proofPath);
		}

		const step: TStepperStep = {
			gwta: outcome,
			virtual: true,
			handlesUndefined: true,
			source: {
				lineNumber,
				path: actualSourcePath || proofPath,
			},
			description: `Outcome: ${outcome}. Proof: ${proofStatements.join('; ')}`,
			action: async (args: TStepArgs, featureStep: TFeatureStep): Promise<TActionResult> => {
				const robustArgs: Record<string, string> = { ...(args as Record<string, string>) };
				if (featureStep.action.stepValuesMap) {
					for (const [key, val] of Object.entries(featureStep.action.stepValuesMap)) {
						if (robustArgs[key] === undefined && val.term !== undefined) {
							robustArgs[key] = val.term;
						}
					}
				}

				// 1. Check Proof (Speculative)
				if (normalizedProofSteps.length > 0) {
					const proof = await this.runner.runStatements(normalizedProofSteps, { args: robustArgs, intent: { mode: 'speculative' }, parentStep: featureStep });

					if (proof.kind === 'ok') {
						return actionOK({ topics: { proofStatements } });
					}
				}

				// 2. Proof Failed or not present
				if (!featureStep.intent?.stepperOptions?.isEnsure) {
					if (normalizedActivitySteps && normalizedActivitySteps.length > 0) {
						const mode = featureStep.intent?.mode === 'speculative' ? 'speculative' : 'authoritative';
						const act = await this.runner.runStatements(normalizedActivitySteps, { args: robustArgs, intent: { mode, usage: featureStep.intent?.usage }, parentStep: featureStep });
						if (act.kind !== 'ok') {
							return actionNotOK(`ActivitiesStepper: activity body failed for outcome "${outcome}": ${act.message}`);
						}
						return actionOK({ topics: { proofStatements } });
					}

					if (proofStatements.length > 0) {
						return actionNotOK(`ActivitiesStepper: proof failed for outcome "${outcome}"`);
					}
					return actionOK({ topics: { proofStatements } });
				}

				// 3. Ensure Mode: Run Activity Body
				if (normalizedActivitySteps && normalizedActivitySteps.length > 0) {
					const mode = featureStep.intent?.mode === 'speculative' ? 'speculative' : 'authoritative';
					const act = await this.runner.runStatements(normalizedActivitySteps, { args: robustArgs, intent: { mode, usage: featureStep.intent?.usage }, parentStep: featureStep });
					if (act.kind !== 'ok') {
						return actionNotOK(`ActivitiesStepper: activity body failed for outcome "${outcome}": ${act.message}`);
					}

					// 4. Verify Proof After Activity
					if (normalizedProofSteps.length > 0) {
						const verify = await this.runner.runStatements(normalizedProofSteps, { args: robustArgs, intent: { mode, usage: featureStep.intent?.usage }, parentStep: featureStep });
						if (verify.kind !== 'ok') {
							return actionNotOK(`ActivitiesStepper: proof verification failed after activity body for outcome "${outcome}": ${verify.message}`);
						}
					}
					return actionOK({ topics: { proofStatements } });
				}

				return actionNotOK(`ActivitiesStepper: no activity body for outcome "${outcome}"`);
			}
		};

		this.steps[outcome] = step;
		if (!isBackground) {
			if (!this.featureSteps.has(proofPath)) {
				this.featureSteps.set(proofPath, {});
			}
			this.featureSteps.get(proofPath)![outcome] = step;
		} else {
			this.backgroundSteps[outcome] = step;
		}
	}

	sendGraphLinkMessages(): void {
		for (const [outcome, metadata] of this.registeredOutcomeMetadata.entries()) {
			this.getWorld().eventLogger.emit(ControlEvent.parse({
				id: `graph-link-${outcome}`,
				timestamp: Date.now(),
				kind: 'control',
				level: 'debug',
				signal: 'graph-link',
				topics: {
					outcome,
					proofStatements: metadata.proofStatements,
					proofPath: metadata.proofPath,
					isBackground: metadata.isBackground,
					activityBlockSteps: metadata.activityBlockSteps ?? null,
					lineNumber: metadata.lineNumber,
				}
			}));
		}
	}

	private resolveWaypointCommon(line: string, path: string, allLines: string[] | undefined, lineIndex: number | undefined, requireProof: boolean, actualSourcePath?: string): boolean {
		if (!line.match(/^waypoint\s+/i)) {
			return false;
		}

		let outcome: string;
		let proofStatements: string[] = [];

		if (requireProof) {
			if (!line.match(/^waypoint\s+.+?\s+with\s+/i)) {
				return false;
			}
			const withoutPrefix = line.replace(/^waypoint\s+/i, '');
			const lastWithIndex = withoutPrefix.lastIndexOf(' with ');
			if (lastWithIndex === -1) return false;

			outcome = withoutPrefix.substring(0, lastWithIndex).trim();
			const proofRaw = withoutPrefix.substring(lastWithIndex + 6).trim();
			proofStatements = proofRaw.split('\n').map(s => s.trim()).filter(s => s.length > 0);
		} else {
			if (line.match(/^waypoint\s+.+?\s+with\s+/i)) {
				return false;
			}
			const match = line.match(/^waypoint\s+(.+?)$/i);
			if (!match) return false;
			outcome = match[1].trim();
		}

		if (this.backgroundOutcomePatterns.has(outcome) || this.featureOutcomePatterns.has(outcome)) {
			return true;
		}

		const isBackground = path.includes('backgrounds/');

		let activityBlockSteps: TStepInput[] | undefined;

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
				const blockLines: TStepInput[] = [];
				for (let i = activityStartLine + 1; i < lineIndex; i++) {
					const stepLine = getActionable(allLines[i]);
					if (stepLine && !stepLine.match(/^waypoint\s+/i)) {
						blockLines.push({
							in: stepLine,
							source: {
								lineNumber: i + 1,
								path: actualSourcePath || path
							}
						});
					}
				}
				activityBlockSteps = blockLines;
			}
		}
		this.registerOutcome(outcome, proofStatements, path, isBackground, activityBlockSteps, lineIndex !== undefined ? lineIndex + 1 : undefined, actualSourcePath);
		return true;
	}
}

export default ActivitiesStepper;
