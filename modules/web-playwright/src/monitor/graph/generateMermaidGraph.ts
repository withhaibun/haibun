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

	// Normalize registeredOutcomes keys to a canonical form for robust matching
	const normalizedRegisteredOutcomes = new Map<string, RegisteredOutcomeEntry>();
	if (registeredOutcomes) {
		for (const [k, v] of Object.entries(registeredOutcomes)) {
			const nk = String(k).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
			normalizedRegisteredOutcomes.set(nk, v);
			// If the original key contains placeholder braces, also index a stripped variant
		if (String(k).includes('{')) {
			const stripped = String(k).replace(/\{[^}]+\}/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
			if (stripped && stripped !== nk) normalizedRegisteredOutcomes.set(stripped, v);
		}
	}
}

	// helper removed — using substring matching only	// Pre-populate waypointMap from registeredOutcomes so dynamic outcomes are available for matching
	// include an optional sourcePath so we can group waypoints by the file they came from
	const waypointMapFromRegistered = new Map<string, { id: string; label: string; parentActivityKey?: string; proof?: string; sourcePath?: string }>();
	if (normalizedRegisteredOutcomes.size) {
		let wpIdx = 0;
		for (const [nk, entry] of normalizedRegisteredOutcomes.entries()) {
			const wpId = `wp_registered_${wpIdx++}`;
			// Use the normalized key as the fallback display; record proofPath as sourcePath when available
			const outcomeLabel = nk;
			waypointMapFromRegistered.set(nk, {
				id: wpId,
				label: outcomeLabel,
				proof: entry.proofStatements?.[0], // Use first proof statement if available
				sourcePath: entry.proofPath,
			});
		}
	}

	// BASES (defined first, top-level)
	const baseLocations = getBaseLocations(resolvedFeatures);
	baseLocations.forEach(basePath => {
		const basePathStr = String(basePath);
		graphLines.push(`    base_${sanitize(basePathStr)}(${formatLabel(basePathStr)})`);
	});

	// ENV SUBGRAPH (collect values with source === 'env')
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

	// BACKGROUNDS SUBGRAPH
	const { getBackgroundFeatures } = await import('./feature-bases.js');
	const backgrounds = getBackgroundFeatures(resolvedFeatures);
	if (backgrounds.size) {
		graphLines.push('    subgraph BACKGROUNDS [Backgrounds]');
		backgrounds.forEach(bgPath => { // bgPath is the path string from the Set
			graphLines.push(`        bg_${sanitize(bgPath)}[${formatLabel(bgPath)}]`);
		});
		graphLines.push('    end');
	}


	// FEATURES & SCENARIOS
	const baseToStepLinks: Array<{ baseId: string; featureId: string }> = []; // structured entries
	const featureFirstNodeId = new Map<string, string | null>();

	// Maps for special step types. Activities are collected but not emitted inline.
	const activityMap = new Map<string, { id: string; label: string }>();
	// waypointMap keyed by the canonical outcome string (as registered by ActivitiesStepper)
	const waypointMap = new Map<string, { id: string; label: string; parentActivityKey?: string; proof?: string; sourcePath?: string }>();
	const proofMap = new Map<string, { id: string; label: string }>();
	const ensureSteps: { sourceId: string; label: string; outcomeKey?: string }[] = [];

	resolvedFeatures.forEach((feature, featureIdx) => {
		const featureId = `f_${sanitize(feature.path)}_${featureIdx}`;
		// Use featureId directly as the subgraph ID for cleaner grouping
		graphLines.push(`    subgraph ${featureId} [${formatLabel(feature.path)}]`);

	// Link base to the feature; we'll resolve to the first real step node later
	const baseId = `base_${sanitize(feature.base)}`;
	baseToStepLinks.push({ baseId, featureId }); // placeholder mapping

		let scenarioIdx = 0;
	let currentScenarioId: string | null = null;
	// Track the current activity within this feature (Activity: Name)
	let currentActivityKey: string | null = null;
		let previousStepActualId: string | null = null;
		let previousStepIsInScenario: boolean = false;
		let firstNodeCaptured = false;

		feature.featureSteps.forEach((step, stepIdx) => {
			let skipEmitThisStep = false;
			// Assuming step.action and step.action.actionName are always present
			const actionNamePart = sanitize(step.action!.actionName);
			const actionLower = String(step.action!.actionName).toLowerCase();
			const label = formatLabel(step.in);
			const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

			const newStepId = `s_${featureIdx}_${actionNamePart}_${stepIdx}`;
			const indent = currentScenarioId ? '            ' : '        ';
			const currentStepIsInCurrentScenario = !!currentScenarioId;

			// Detect whether the current step is a proof node so we can render step->proof links dotted
			const currentIsProof = actionLower.includes('proof') || actionLower === 'proof';

			if (step.action!.actionName === 'scenarioStart') {
				if (currentScenarioId) graphLines.push('        end'); // End previous scenario subgraph
				currentScenarioId = `sc_${++scenarioIdx}`;
				graphLines.push(`        subgraph ${currentScenarioId} [${formatLabel(step.in)}]`);
				previousStepActualId = null; // Reset for steps within the new scenario
			} else {
				// Detect Activity header and capture its name as the current activity key
				if (/^activity\s*:/i.test(step.in)) {
					// Extract the activity name after the colon
					const m = step.in.match(/^Activity:\s*(.+)$/i);
					const activityName = m ? m[1].trim() : step.in;
					const activityKey = activityName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
					currentActivityKey = activityKey;
					if (!activityMap.has(activityKey)) {
						const actId = `act_${featureIdx}_${activityMap.size}`;
						activityMap.set(activityKey, { id: actId, label: activityName });
					}
					// Do not emit the Activity header as an inline node
					previousStepIsInScenario = currentStepIsInCurrentScenario;
					skipEmitThisStep = true;
				}

				if (actionLower.includes('activity')) {
					// Fallback: collect activity (do not emit inline in feature)
					const activityKey = normalized;
					if (!activityMap.has(activityKey)) {
						const actId = `act_${featureIdx}_${activityMap.size}`;
						activityMap.set(activityKey, { id: actId, label });
					}
					// set current activity context to this activity key
					currentActivityKey = activityKey;
				} else {
				// Emit the actual step node inline for non-activity steps
				if (!skipEmitThisStep) {
					graphLines.push(`${indent}${newStepId}[${label}]`);
				}

				// Capture the first node for the feature (used for base -> node linking)
				if (!firstNodeCaptured) {
					featureFirstNodeId.set(featureId, newStepId);
					firstNodeCaptured = true;
				}

				// Link from previous actual step in the same scope (feature or scenario)
				if (previousStepActualId) {
					if (currentStepIsInCurrentScenario === previousStepIsInScenario) {
						// If either side is a proof node, render a dotted connector to visually distinguish proofs
						const prevIsProof = proofMap && Array.from(proofMap.values()).some(p => p.id === previousStepActualId);
						const connector = (prevIsProof || currentIsProof) ? '-.->' : '==>';
						graphLines.push(`${indent}${previousStepActualId} ${connector} ${newStepId}`);
					}
				}
				previousStepActualId = newStepId;

				// Link to background if step is from background
				if (step.path !== feature.path) {
					if (backgrounds.has(step.path)) {
						graphLines.push(`${indent}${newStepId} -.-> bg_${sanitize(step.path)}`);
					} else {
						console.warn(`Background step patah "${step.path}" not found in backgrounds set.`);
					}
				}

				// Record other special step types for later linking
				if (actionLower === 'ensure' || actionLower.includes('ensure')) {
					// Try to extract the structured outcome term from stepValuesMap if available
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

				// For waypoint steps, extract canonical outcome string instead of using the whole step text
				if (actionLower.includes('waypoint') || actionLower.includes('waypointed') || actionLower === 'waypoint') {
						const match = step.in.match(/^waypoint\s+(.+?)\s+with\s+(.+)$/i);
						const outcome = match ? match[1].trim() : step.in;
						const proof = match ? match[2].trim() : undefined;
						const wpKey = outcome.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
						// record the source path so we can group by the originating feature file
						waypointMap.set(wpKey, { id: newStepId, label: outcome, parentActivityKey: currentActivityKey ?? undefined, proof, sourcePath: step.path });
				}
				if (actionLower.includes('proof') || actionLower === 'proof') {
					const pfKey = normalized;
					proofMap.set(pfKey, { id: newStepId, label });
				}

				// Inline variable linking logic using new stepValuesMap.source classification
				if (showVariables && step.action!.stepValuesMap && step.action!.actionName !== 'scenarioStart') {
					const definedScenarioVarsForStep = new Set<string>();
					Object.entries(step.action.stepValuesMap).forEach(([name, sv]) => {
						const { origin: source, value } = sv;
						if (value == null) return;
						if (source === 'env' && typeof value === 'string') {
							graphLines.push(`${indent}${newStepId} -.-> env_${sanitize(value)}`);
							return;
						}
						// scenario/shared variable or literal display (exclude statements/arrays)
						if (Array.isArray(value)) return; // skip nested statements
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
		if (currentScenarioId) graphLines.push('        end'); // End the last scenario subgraph
		graphLines.push('    end');
		if (!firstNodeCaptured) featureFirstNodeId.set(featureId, null);
	});
	// Merge inline waypointMap with pre-populated from registeredOutcomes
	// Pre-populated entries take precedence for matching
	const mergedWaypointMap = new Map<string, { id: string; label: string; parentActivityKey?: string; proof?: string; sourcePath?: string }>(waypointMapFromRegistered);
	for (const [k, v] of waypointMap.entries()) {
		if (!mergedWaypointMap.has(k)) {
			mergedWaypointMap.set(k, v);
		}
	}

	// Now, for each ensure step, render waypoints and proofs
	const renderedProofs = new Set<string>();

	// Create Proofs subgraph lazily when needed and track used waypoints across blocks
	let proofsStarted = false;
	const usedWaypoints = new Set<string>();

	if (ensureSteps.length || mergedWaypointMap.size) {

		for (const ens of ensureSteps) {
			// Try to match ensure to a registered waypoint
			if (!ens.outcomeKey || normalizedRegisteredOutcomes.size === 0) continue;

			const nk = ens.outcomeKey!.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
			let regEntry = normalizedRegisteredOutcomes.get(nk);
			let wpKey: string | undefined;

			if (regEntry) {
				wpKey = nk;
			} else {
				// Fuzzy fallback: try matching by stripping placeholder tokens
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

			// Find the waypoint node in mergedWaypointMap
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

			// Mark this waypoint as used and record the link from ensure -> waypoint
			usedWaypoints.add(wp.id);
			// Use the existing double-arrow style for ensure -> waypoint links (matches existing step chaining)
			graphLines.push(`    ${ens.sourceId} ==> ${wp.id}`);

			// Link waypoint to proof. Prefer registered proofStatements, otherwise fall back to inline waypoint.proof
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

				// Use a dotted arrow from waypoint -> proof to visually distinguish proof links
				graphLines.push(`    ${wp.id} -.-> ${proofId}`);
			}
		}
	}

	// Now render waypoints. Only include waypoints that are actually used (linked to ensure steps).
	// Do NOT include unused inline waypoints even if they're from the current feature.

	// Build map: sourcePath -> array of waypoint entries (only used ones)
	const wpBySource = new Map<string, Array<{ id: string; label: string }>>();
	for (const [, v] of mergedWaypointMap.entries()) {
		// Only render waypoints that are actually used/linked
		if (!usedWaypoints.has(v.id)) continue;
		const source = v.sourcePath || v.proof || 'registered';
		const arr = wpBySource.get(source) || [];
		arr.push({ id: v.id, label: v.label });
		wpBySource.set(source, arr);
	}

	// Emit a top-level WAYPOINTS group which contains subgraphs per source file when there are any entries
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
// Replace base->feature placeholders with base->firstNode links where possible
	const resolvedBaseToStepLinks: string[] = baseToStepLinks.map(({ baseId, featureId }) => {
		const firstNode = featureFirstNodeId.get(featureId);
		if (firstNode) return `    ${baseId} --> ${firstNode}`;
		return `    ${baseId} --> ${featureId}`; // fallback to subgraph link
	});

	graphLines.push(...resolvedBaseToStepLinks);

	// Controls are handled by the artifact display (ResolvedFeaturesArtifactDisplay). Do not append inline controls here.

	return graphLines;
}
