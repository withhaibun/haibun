import { describe, it, expect } from 'vitest';
import { generateMermaidGraph } from './generateMermaidGraph.js';
import type { TResolvedFeature } from '@haibun/core/lib/defs.js';
import { EExecutionMessageType, type TMessageContext } from '@haibun/core/lib/interfaces/logger.js';

type RegisteredOutcomeEntry = { proofStatements?: string[]; proofPath?: string; isBackground?: boolean; activityBlockSteps?: string[] };
type MinimalStep = { in: string; path?: string; action: { actionName: string } };
function makeStep(inText: string, actionName: string, path = 'feature1'): MinimalStep { return { in: inText, path, action: { actionName } }; }

/**
 * Simulates runtime message capture (as collected by MonitorHandler into window.haibunCapturedMessages).
 * The display collector parses these messages to extract registeredOutcomes from ActivitiesStepper.registerOutcome DEBUG entries.
 */
function buildCapturedMessages(outcomes: Array<{
  outcome: string;
  proofStatements: string[];
  proofPath: string;
  isBackground?: boolean;
  activityBlockSteps?: string[];
}>): Array<{ messageContext: TMessageContext }> {
  return outcomes.map(oc => ({
    messageContext: {
      incident: EExecutionMessageType.GRAPH_LINK,
      incidentDetails: {
        outcome: oc.outcome,
        proofStatements: oc.proofStatements,
        proofPath: oc.proofPath,
        isBackground: oc.isBackground ?? false,
        activityBlockSteps: oc.activityBlockSteps ?? null,
      }
    }
  }));
}

describe('generateMermaidGraph', () => {
  it('renders activity -> waypoint -> proof chain when registeredOutcomes provided', async () => {
    const feature: TResolvedFeature = {
      path: 'features/example.feature',
      base: 'features',
      featureSteps: [
        makeStep('Activity: Do the thing', 'comment'),
        makeStep('waypoint Task completed with proof-file.txt', 'waypoint'),
        makeStep('proof Evidence attached', 'proof'),
        makeStep('ensure Task completed', 'ensure'),
      ] as unknown as TResolvedFeature['featureSteps'],
    } as TResolvedFeature;

    const registeredOutcomes: Record<string, RegisteredOutcomeEntry> = {
      'task completed': { proofStatements: ['Evidence attached'], proofPath: 'proof-file.txt', isBackground: false },
    };

    const lines = await generateMermaidGraph([feature], false, registeredOutcomes);
    const joined = lines.join('\n');

    expect(joined).toContain('subgraph WAYPOINTS');
    expect(joined).toContain('subgraph PROOFS');

    // Ensure step should link to waypoint
    expect(joined).toMatch(/s_0_ensure_\d+\s*==>\s*wp_registered_/);
    // Waypoint should link to proof
    expect(joined).toMatch(/wp_registered_\d+\s*-\.->.*proof_/);
    expect(joined).toContain('Task completed');
  });

  it('extracts outcomes from runtime messageContext (as captured by MonitorHandler)', async () => {
    const feature: TResolvedFeature = {
      path: 'features/activities.feature',
      base: 'features',
      featureSteps: [
        makeStep('Activity: User login flow', 'comment'),
        makeStep('waypoint Is logged in as user {who} with set "loginType" to "user"', 'waypoint'),
        makeStep('proof Token is valid', 'proof'),
        makeStep('ensure Is logged in as user admin', 'ensure'),
      ] as unknown as TResolvedFeature['featureSteps'],
    } as TResolvedFeature;

    // Simulate the runtime message capture (as it arrives from ActivitiesStepper.registerOutcome)
    const capturedMessages = buildCapturedMessages([
      {
        outcome: 'Is logged in as user {who}',
        proofStatements: ['set "loginType" to "user"'],
        proofPath: 'features/activities.feature',
        isBackground: false,
        activityBlockSteps: ['User login flow'],
      }
    ]);

    // The display collector converts this to registeredOutcomes by normalizing keys
    // (lowercase and non-alphanumeric -> spaces; also index placeholder-stripped variants)
    const registeredOutcomes: Record<string, RegisteredOutcomeEntry> = {};
    for (const entry of capturedMessages) {
      const mc = entry.messageContext;
      if (mc.incident === EExecutionMessageType.GRAPH_LINK && mc.incidentDetails && typeof mc.incidentDetails === 'object') {
        const details = mc.incidentDetails as Record<string, unknown>;
        const outcomeRaw = String(details['outcome'] || '').trim();
        if (!outcomeRaw) continue;
        const key = outcomeRaw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const stripped = outcomeRaw.replace(/\{[^}]+\}/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        registeredOutcomes[key] = {
          proofStatements: Array.isArray(details['proofStatements']) ? (details['proofStatements'] as string[]) : undefined,
          proofPath: typeof details['proofPath'] === 'string' ? (details['proofPath'] as string) : undefined,
          isBackground: typeof details['isBackground'] === 'boolean' ? details['isBackground'] as boolean : undefined,
          activityBlockSteps: Array.isArray(details['activityBlockSteps']) ? (details['activityBlockSteps'] as string[]) : undefined,
        };
        if (stripped && stripped !== key) {
          registeredOutcomes[stripped] = registeredOutcomes[key];
        }
      }
    }

    const lines = await generateMermaidGraph([feature], false, registeredOutcomes);
    const joined = lines.join('\n');

    // The generator should now find the pattern-to-instance match and emit Waypoint/Proof chains
    expect(joined).toContain('subgraph WAYPOINTS');
    expect(joined).toContain('Waypoints');
    expect(joined).toMatch(/==>\s*wp_/);
    expect(joined).toContain('Is logged in as user');
  });

  it('links ensure steps directly to waypoints from registeredOutcomes', async () => {
    const feature: TResolvedFeature = {
      path: 'features/test.feature',
      base: 'features',
      featureSteps: [
        // Feature only has the ensure step; waypoints come from registeredOutcomes
        makeStep('ensure Is logged in as user Personoid', 'ensure'),
        makeStep('variable "loginType" is "user"', 'variable'),
      ] as unknown as TResolvedFeature['featureSteps'],
    } as TResolvedFeature;

    // Outcomes registered via ActivitiesStepper (with placeholders that need to match concrete ensure)
    const registeredOutcomes: Record<string, RegisteredOutcomeEntry> = {
      'is logged in as user who': {
        proofStatements: ['set "loginType" to "user"'],
        proofPath: 'features/activities.feature',  // Where the waypoint was defined
        isBackground: false,
        activityBlockSteps: [],
      },
      // Also include the placeholder-stripped variant for matching
      'is logged in as user': {
        proofStatements: ['set "loginType" to "user"'],
        proofPath: 'features/activities.feature',
        isBackground: false,
        activityBlockSteps: [],
      },
    };

    const lines = await generateMermaidGraph([feature], false, registeredOutcomes);
    const joined = lines.join('\n');

    // Core expectations: should have WAYPOINTS and PROOFS subgraphs
    expect(joined).toContain('subgraph WAYPOINTS');
    expect(joined).toContain('subgraph PROOFS');

    // Ensure step should link directly to waypoint: s_0_ensure_0 ==> wp_registered_...
    expect(joined).toMatch(/s_0_ensure_0\s*==>\s*wp_registered_/);

    // Waypoint should link to proof: wp_registered_... -.-> proof_...
    expect(joined).toMatch(/wp_registered_\d+\s*-\.->.*proof_/);

    // Proof node should include the file path where waypoint was defined
    expect(joined).toContain('features/activities.feature');

    // Should have waypoint node with label (the outcome pattern)
    expect(joined).toMatch(/wp_registered_\d+\["is logged in as user/);

    // VERIFY ACTUAL MERMAID LINKING LINES EXIST
    const ensureToWpLine = joined.match(/s_0_ensure_0\s*==>\s*wp_registered_\d+/);
    expect(ensureToWpLine).toBeTruthy();
    console.log('✓ Ensure to waypoint link found:', ensureToWpLine?.[0]);

    const wpToProofLine = joined.match(/wp_registered_\d+\s*-\.->.*proof_/);
    expect(wpToProofLine).toBeTruthy();
    console.log('✓ Waypoint to proof link found:', wpToProofLine?.[0]);
  });

  it('verifies GRAPH_LINK messages are properly collected and rendered in mermaid', async () => {
    const feature: TResolvedFeature = {
      path: 'features/test.feature',
      base: 'features',
      featureSteps: [
        makeStep('ensure Navigate to mainUrl', 'ensure'),
        makeStep('variable pagesVisited is 2', 'variable'),
      ] as unknown as TResolvedFeature['featureSteps'],
    } as TResolvedFeature;

    // Simulate GRAPH_LINK messages being emitted at runtime
    const capturedMessages = buildCapturedMessages([
      {
        outcome: 'Navigate to {page}',
        proofStatements: ['set "currentPage" to "{page}"'],
        proofPath: 'features/wikipedia.feature',
        isBackground: true,
        activityBlockSteps: [],
      }
    ]);

    // Verify the captured messages have GRAPH_LINK incident type
    expect(capturedMessages.length).toBe(1);
    expect(capturedMessages[0].messageContext.incident).toBe(EExecutionMessageType.GRAPH_LINK);
    expect(capturedMessages[0].messageContext.incidentDetails?.outcome).toBe('Navigate to {page}');

    // Parse like ResolvedFeaturesArtifactDisplay does
    const registeredOutcomes: Record<string, RegisteredOutcomeEntry> = {};
    for (const entry of capturedMessages) {
      const mc = entry.messageContext;
      if (mc.incident === EExecutionMessageType.GRAPH_LINK && mc.incidentDetails && typeof mc.incidentDetails === 'object') {
        const details = mc.incidentDetails as Record<string, unknown>;
        const outcomeRaw = String(details['outcome'] || '').trim();
        if (!outcomeRaw) continue;
        const key = outcomeRaw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const stripped = outcomeRaw.replace(/\{[^}]+\}/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        registeredOutcomes[key] = {
          proofStatements: Array.isArray(details['proofStatements']) ? (details['proofStatements'] as string[]) : undefined,
          proofPath: typeof details['proofPath'] === 'string' ? (details['proofPath'] as string) : undefined,
          isBackground: typeof details['isBackground'] === 'boolean' ? details['isBackground'] as boolean : undefined,
          activityBlockSteps: Array.isArray(details['activityBlockSteps']) ? (details['activityBlockSteps'] as string[]) : undefined,
        };
        if (stripped && stripped !== key) {
          registeredOutcomes[stripped] = registeredOutcomes[key];
        }
      }
    }

    // Verify outcomes were collected
    expect(Object.keys(registeredOutcomes).length).toBeGreaterThan(0);
    expect(registeredOutcomes['navigate to page']).toBeDefined();
    expect(registeredOutcomes['navigate to page']?.proofPath).toBe('features/wikipedia.feature');

    // Generate graph with these outcomes
    const lines = await generateMermaidGraph([feature], false, registeredOutcomes);
    const joined = lines.join('\n');

    // Verify the graph contains the linked outcomes
    expect(joined).toContain('subgraph WAYPOINTS');
    expect(joined).toContain('subgraph PROOFS');
    expect(joined).toMatch(/s_0_ensure_0\s*==>\s*wp_registered_/);
    expect(joined).toMatch(/wp_registered_\d+\s*-\.->.*proof_/);
    expect(joined).toContain('features/wikipedia.feature');
  });
});
