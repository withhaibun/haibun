import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * This test verifies that the generated monitor.html contains proper waypoint and proof linking
 * in the mermaid graph after running the activities feature.
 */
describe('Monitor Graph Verification', () => {
  it('should contain WAYPOINTS and PROOFS subgraphs with proper linking', () => {
    // Find the most recent monitor.html in capture directory
    const captureDir = join(__dirname, '..', 'capture', 'default');

    if (!readdirSync(captureDir).length) {
      throw new Error('No capture directories found. Run: npm test -- activities first');
    }

    // Get most recent capture directory
    const captureDirs = readdirSync(captureDir)
      .map(name => join(captureDir, name))
      .filter(path => statSync(path).isDirectory())
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

    expect(captureDirs.length).toBeGreaterThan(0);

    // Find monitor.html in the most recent capture
    const monitorPath = join(captureDirs[0], 'seq-0', 'featn-1', 'monitor.html');
    const html = readFileSync(monitorPath, 'utf-8');

    // Extract the mermaid code from the HTML
    const mermaidMatch = html.match(/<pre class="haibun-mermaid-code"[^>]*>([\s\S]*?)<\/pre>/);
    expect(mermaidMatch).toBeTruthy();

    const mermaidCode = mermaidMatch![1].trim();

    console.log('\n=== EXTRACTED MERMAID CODE ===');
    console.log(mermaidCode);
    console.log('=== END MERMAID CODE ===\n');

    // Verify WAYPOINTS subgraph exists
    expect(mermaidCode).toContain('subgraph WAYPOINTS');

    // Verify PROOFS subgraph exists
    expect(mermaidCode).toContain('subgraph PROOFS');

    // Verify waypoint nodes exist (wp_registered_X format)
    const waypointNodes = mermaidCode.match(/wp_registered_\d+/g);
    expect(waypointNodes).toBeTruthy();
    expect(waypointNodes!.length).toBeGreaterThan(0);
    console.log(`Found ${waypointNodes!.length} waypoint nodes:`, waypointNodes);

    // Verify proof nodes exist (proof_X format)
    const proofNodes = mermaidCode.match(/proof_\d+/g);
    expect(proofNodes).toBeTruthy();
    expect(proofNodes!.length).toBeGreaterThan(0);
    console.log(`Found ${proofNodes!.length} proof nodes:`, proofNodes);

    // Verify ensure steps link to waypoints with dotted arrows (s_X_ensure_Y -.-> wp_registered_Z)
    const ensureToWaypointLinks = mermaidCode.match(/s_\d+_ensure_\d+\s*-\.->.*wp_registered_\d+/g);
    expect(ensureToWaypointLinks).toBeTruthy();
    expect(ensureToWaypointLinks!.length).toBeGreaterThan(0);
    console.log(`Found ${ensureToWaypointLinks!.length} ensure->waypoint links:`, ensureToWaypointLinks);

    // Verify waypoints link to proofs with dotted arrows (wp_registered_X -.-> proof_Y)
    const waypointToProofLinks = mermaidCode.match(/wp_registered_\d+\s*-\.->.*proof_\d+/g);
    expect(waypointToProofLinks).toBeTruthy();
    expect(waypointToProofLinks!.length).toBeGreaterThan(0);
    console.log(`Found ${waypointToProofLinks!.length} waypoint->proof links:`, waypointToProofLinks);

    // Success
    console.log('\n✓ All linking verified in generated monitor.html');
  });

  it('should verify GRAPH_LINK messages were captured in monitor', () => {
    const captureDir = join(__dirname, '..', 'capture', 'default');
    const captureDirs = readdirSync(captureDir)
      .map(name => join(captureDir, name))
      .filter(path => statSync(path).isDirectory())
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

    const monitorPath = join(captureDirs[0], 'seq-0', 'featn-1', 'monitor.html');
    const html = readFileSync(monitorPath, 'utf-8');

    // Check if window.haibunCapturedMessages contains GRAPH_LINK incidents
    const capturedMessagesMatch = html.match(/window\.haibunCapturedMessages\s*=\s*(\[[\s\S]*?\]);/);
    expect(capturedMessagesMatch).toBeTruthy();

    const capturedMessagesJson = capturedMessagesMatch![1];

    // Parse the JSON to verify GRAPH_LINK messages exist
    const messages = JSON.parse(capturedMessagesJson);

    const graphLinkMessages = messages.filter((msg: any) =>
      msg.messageContext?.incident === 'GRAPH_LINK'
    );

    console.log(`\nFound ${graphLinkMessages.length} GRAPH_LINK messages in captured data`);

    if (graphLinkMessages.length > 0) {
      console.log('\nSample GRAPH_LINK message:');
      console.log(JSON.stringify(graphLinkMessages[0].messageContext.incidentDetails, null, 2));
    }

    expect(graphLinkMessages.length).toBeGreaterThan(0);
  });
});
