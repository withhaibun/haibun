import { TResolvedFeature } from '@haibun/core/lib/defs.js';
import { sanitize, formatLabel } from './graphUtils.js';
import { getBaseLocations } from './feature-bases.js';

type RegisteredOutcomeEntry = {
	proofStatements?: string[];
	proofPath?: string;
	isBackground?: boolean;
	activityBlockSteps?: string[];
};

export async function generateMermaidGraphAsMarkdown(resolvedFeatures: TResolvedFeature[], showVariables = true, registeredOutcomes?: Record<string, RegisteredOutcomeEntry>): Promise<string> {
	const graphLines = await generateMermaidGraph(resolvedFeatures, showVariables, registeredOutcomes);
	return graphLines.join('\n');
}

export async function generateMermaidGraph(resolvedFeatures: TResolvedFeature[], showVariables = true, registeredOutcomes?: Record<string, RegisteredOutcomeEntry>): Promise<string[]> {
	const graphLines: string[] = ['graph TD'];

	// Normalize outcome keys for fuzzy matching (handles "Is logged in" vs "Is logged in as {user}")
	const normalizedRegisteredOutcomes = new Map<string, RegisteredOutcomeEntry>();
	if (registeredOutcomes) {
		for (const [k, v] of Object.entries(registeredOutcomes)) {
			const nk = String(k).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
			normalizedRegisteredOutcomes.set(nk, v);
			// Also index variant with placeholders stripped for fuzzy matching
			if (String(k).includes('{')) {
				const stripped = String(k).replace(/\{[^}]+\}/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
				if (stripped && stripped !== nk) normalizedRegisteredOutcomes.set(stripped, v);
			}
		}
	}

	const waypointMapFromRegistered = new Map<string, { id: string; label: string; parentActivityKey?: string; proof?: string; sourcePath?: string }>();
	if (normalizedRegisteredOutcomes.size) {
		let wpIdx = 0;
		for (const [nk, entry] of normalizedRegisteredOutcomes.entries()) {
			const wpId = `wp_registered_${wpIdx++}`;
			const outcomeLabel = nk;
			waypointMapFromRegistered.set(nk, {
				id: wpId,
				label: outcomeLabel,
				proof: entry.proofStatements?.[0],
				sourcePath: entry.proofPath,
			});
		}
	}

	const baseLocations = getBaseLocations(resolvedFeatures);
	baseLocations.forEach(basePath => {
		const basePathStr = String(basePath);
		graphLines.push(`    base_${sanitize(basePathStr)}(${formatLabel(basePathStr)})`);
	});

	const envVars = new Set<string>();
	for (const f of resolvedFeatures) {
		for (const step of f.featureSteps) {
			for (const { origin: source, value } of Object.values(step.action.stepValuesMap || {})) {
				if (source === 'env' && typeof value === 'string') envVars.add(value);
			}
		}
	}
	if (envVars.size) {
		graphLines.push('    subgraph ENV [Environment Variables]');
		envVars.forEach(v => graphLines.push(`        env_${sanitize(v)}([${formatLabel(v)}])`));
		graphLines.push('    end');
	}

	const { getBackgroundFeatures } = await import('./feature-bases.js');
	const backgrounds = getBackgroundFeatures(resolvedFeatures);
	if (backgrounds.size) {
		graphLines.push('    subgraph BACKGROUNDS [Backgrounds]');
		backgrounds.forEach(bgPath => {
			graphLines.push(`        bg_${sanitize(bgPath)}[${formatLabel(bgPath)}]`);
		});
		graphLines.push('    end');
	}

	const baseToStepLinks: Array<{ baseId: string; featureId: string }> = [];
	const featureFirstNodeId = new Map<string, string | null>();

	const activityMap = new Map<string, { id: string; label: string }>();
	const waypointMap = new Map<string, { id: string; label: string; parentActivityKey?: string; proof?: string; sourcePath?: string }>();
	const proofMap = new Map<string, { id: string; label: string }>();
	const ensureSteps: { sourceId: string; label: string; outcomeKey?: string }[] = [];

	resolvedFeatures.forEach((feature, featureIdx) => {
		const featureId = `f_${sanitize(feature.path)}_${featureIdx}`;
		graphLines.push(`    subgraph ${featureId} [${formatLabel(feature.path)}]`);

		const baseId = `base_${sanitize(feature.base)}`;
		baseToStepLinks.push({ baseId, featureId });

		let scenarioIdx = 0;
		let currentScenarioId: string | null = null;
		let currentActivityKey: string | null = null;
		let previousStepActualId: string | null = null;
		let previousStepIsInScenario: boolean = false;
		let firstNodeCaptured = false;

		feature.featureSteps.forEach((step, stepIdx) => {
			let skipEmitThisStep = false;
			const actionNamePart = sanitize(step.action!.actionName);
			const actionLower = String(step.action!.actionName).toLowerCase();
			const label = formatLabel(step.in);
			const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

			const newStepId = `s_${featureIdx}_${actionNamePart}_${stepIdx}`;
			const indent = currentScenarioId ? '            ' : '        ';
			const currentStepIsInCurrentScenario = !!currentScenarioId;

			const currentIsProof = actionLower.includes('proof') || actionLower === 'proof';

			if (step.action!.actionName === 'scenarioStart') {
				if (currentScenarioId) graphLines.push('        end');
				currentScenarioId = `sc_${++scenarioIdx}`;
				graphLines.push(`        subgraph ${currentScenarioId} [${formatLabel(step.in)}]`);
				previousStepActualId = null;
			} else {
				if (/^activity\s*:/i.test(step.in)) {
					const m = step.in.match(/^Activity:\s*(.+)$/i);
					const activityName = m ? m[1].trim() : step.in;
					const activityKey = activityName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
					currentActivityKey = activityKey;
					if (!activityMap.has(activityKey)) {
						const actId = `act_${featureIdx}_${activityMap.size}`;
						activityMap.set(activityKey, { id: actId, label: activityName });
					}
					previousStepIsInScenario = currentStepIsInCurrentScenario;
					skipEmitThisStep = true;
				}

				if (actionLower.includes('activity')) {
					const activityKey = normalized;
					if (!activityMap.has(activityKey)) {
						const actId = `act_${featureIdx}_${activityMap.size}`;
						activityMap.set(activityKey, { id: actId, label });
					}
					currentActivityKey = activityKey;
				} else {
					if (!skipEmitThisStep) {
						graphLines.push(`${indent}${newStepId}[${label}]`);
					}

					if (!firstNodeCaptured) {
						featureFirstNodeId.set(featureId, newStepId);
						firstNodeCaptured = true;
					}

					if (previousStepActualId) {
						if (currentStepIsInCurrentScenario === previousStepIsInScenario) {
							const prevIsProof = proofMap && Array.from(proofMap.values()).some(p => p.id === previousStepActualId);
							const connector = (prevIsProof || currentIsProof) ? '-.->' : '==>';
							graphLines.push(`${indent}${previousStepActualId} ${connector} ${newStepId}`);
						}
					}
					previousStepActualId = newStepId;

				if (step.path !== feature.path) {
					if (backgrounds.has(step.path)) {
						graphLines.push(`${indent}${newStepId} -.-> bg_${sanitize(step.path)}`);
					} else {
						console.warn(`Background step path "${step.path}" not found in backgrounds set.`);
					}
				}

				if (actionLower === 'ensure' || actionLower.includes('ensure')) {
					let outcomeKey: string | undefined = undefined;
					try {
						const sa = step.action as unknown as { stepValuesMap?: Record<string, { term?: string }> };
						const ov = sa.stepValuesMap?.outcome;
						if (ov && (typeof ov.term === 'string' && ov.term.trim().length > 0)) {
							outcomeKey = ov.term.trim();
						}
					} catch {
						// ignore
					}
					// Fallback: parse the ensure line to extract the inner statement (e.g., 'ensure Task completed' -> 'Task completed')
					if (!outcomeKey) {
						const m = step.in.match(/^ensure\s+(.+)$/i);
						if (m) outcomeKey = m[1].trim();
					}
					ensureSteps.push({ sourceId: newStepId, label, outcomeKey });
				}

				if (actionLower.includes('waypoint') || actionLower.includes('waypointed') || actionLower === 'waypoint') {
					const match = step.in.match(/^waypoint\s+(.+?)\s+with\s+(.+)$/i);
					const outcome = match ? match[1].trim() : step.in;
					const proof = match ? match[2].trim() : undefined;
					const wpKey = outcome.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
					waypointMap.set(wpKey, { id: newStepId, label: outcome, parentActivityKey: currentActivityKey ?? undefined, proof, sourcePath: step.path });
				}
				if (actionLower.includes('proof') || actionLower === 'proof') {
					const pfKey = normalized;
					proofMap.set(pfKey, { id: newStepId, label });
				}

				if (showVariables && step.action!.stepValuesMap && step.action!.actionName !== 'scenarioStart') {
					const definedScenarioVarsForStep = new Set<string>();
					Object.entries(step.action.stepValuesMap).forEach(([name, sv]) => {
						const { origin: source, value } = sv;
						if (value == null) return;
						if (source === 'env' && typeof value === 'string') {
							graphLines.push(`${indent}${newStepId} -.-> env_${sanitize(value)}`);
							return;
						}
						if (Array.isArray(value)) return;
						const displayVal = typeof value === 'number' ? String(value) : value;
						const scenarioVarNodeId = `sv_${featureIdx}_${actionNamePart}_${stepIdx}_${sanitize(name)}`;
						if (!definedScenarioVarsForStep.has(scenarioVarNodeId)) {
							graphLines.push(`${indent}${scenarioVarNodeId}([${formatLabel(name + ' = ' + displayVal)}])`);
							definedScenarioVarsForStep.add(scenarioVarNodeId);
						}
						graphLines.push(`${indent}${newStepId} -.-> ${scenarioVarNodeId}`);
					});
				}
			}
		}
			previousStepIsInScenario = currentStepIsInCurrentScenario;
		});
		if (currentScenarioId) graphLines.push('        end');
		graphLines.push('    end');
		if (!firstNodeCaptured) featureFirstNodeId.set(featureId, null);
	});

	// Merge inline waypoints with pre-registered ones (pre-registered take precedence)
	const mergedWaypointMap = new Map<string, { id: string; label: string; parentActivityKey?: string; proof?: string; sourcePath?: string }>(waypointMapFromRegistered);
	for (const [k, v] of waypointMap.entries()) {
		if (!mergedWaypointMap.has(k)) {
			mergedWaypointMap.set(k, v);
		}
	}

	const renderedProofs = new Set<string>();
	let proofsStarted = false;
	const usedWaypoints = new Set<string>();

	if (ensureSteps.length || mergedWaypointMap.size) {
		for (const ens of ensureSteps) {
			if (!ens.outcomeKey || normalizedRegisteredOutcomes.size === 0) continue;

			const nk = ens.outcomeKey!.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
			let regEntry = normalizedRegisteredOutcomes.get(nk);
			let wpKey: string | undefined;

			if (regEntry) {
				wpKey = nk;
			} else {
				// Fuzzy match: strip placeholders and try substring matching
				for (const candidate of normalizedRegisteredOutcomes.keys()) {
					const candStripped = candidate.replace(/\{[^}]+\}/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
					const nkStripped = nk.replace(/\{[^}]+\}/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
					if (candStripped && nkStripped && (candStripped === nkStripped || candStripped.includes(nkStripped) || nkStripped.includes(candStripped))) {
						wpKey = candidate;
						regEntry = normalizedRegisteredOutcomes.get(candidate);
						break;
					}
				}
			}

			if (!regEntry || !wpKey) continue;

			let foundWpKey: string | undefined;
			for (const candidateWpKey of mergedWaypointMap.keys()) {
				const cand = candidateWpKey;
				const candStripped = cand.replace(/\{[^}]+\}/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
				const wpKeyStripped = wpKey.replace(/\{[^}]+\}/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
				if (cand === wpKey || cand.includes(wpKey) || wpKey.includes(cand) || candStripped === wpKeyStripped || candStripped.includes(wpKeyStripped) || wpKeyStripped.includes(candStripped)) {
					foundWpKey = candidateWpKey;
					break;
				}
			}

			if (!foundWpKey) continue;

			const wp = mergedWaypointMap.get(foundWpKey)!;

			usedWaypoints.add(wp.id);
			graphLines.push(`    ${ens.sourceId} -.-> ${wp.id}`);

			const proofText = (regEntry && regEntry.proofStatements && regEntry.proofStatements.length > 0)
				? regEntry.proofStatements[0]
				: (wp.proof || undefined);

			if (proofText) {
				if (!proofsStarted) { graphLines.push('    subgraph PROOFS [Proofs]'); proofsStarted = true; }

				const proofId = `proof_${wp.id}_${sanitize(proofText)}`;
				if (!renderedProofs.has(proofId)) {
					graphLines.push(`        ${proofId}[${formatLabel(proofText)}]`);
					renderedProofs.add(proofId);
				}

				graphLines.push(`    ${wp.id} -.-> ${proofId}`);
			}
		}
	}

	// Group waypoints by source file for organized display (only used waypoints)
	const wpBySource = new Map<string, Array<{ id: string; label: string }>>();
	for (const [, v] of mergedWaypointMap.entries()) {
		if (!usedWaypoints.has(v.id)) continue;
		const source = v.sourcePath || v.proof || 'registered';
		const arr = wpBySource.get(source) || [];
		arr.push({ id: v.id, label: v.label });
		wpBySource.set(source, arr);
	}

	if (usedWaypoints.size > 0 || wpBySource.size > 0) {
		graphLines.push('    subgraph WAYPOINTS [Waypoints]');
		for (const [source, items] of wpBySource.entries()) {
			const subId = `wps_${sanitize(String(source))}`;
			graphLines.push(`        subgraph ${subId} [${formatLabel(String(source))}]`);
			for (const item of items) {
				graphLines.push(`            ${item.id}[${formatLabel(item.label)}]`);
			}
			graphLines.push('        end');
		}
		graphLines.push('    end');
	}

	if (proofsStarted) graphLines.push('    end');

	const resolvedBaseToStepLinks: string[] = baseToStepLinks.map(({ baseId, featureId }) => {
		const firstNode = featureFirstNodeId.get(featureId);
		if (firstNode) return `    ${baseId} --> ${firstNode}`;
		return `    ${baseId} --> ${featureId}`;
	});

	graphLines.push(...resolvedBaseToStepLinks);

	return graphLines;
}
