

// type TResolvedFeature = TResolvedFeaturesArtifact['resolvedFeatures'][number];

export function getMermaidFromResolvedFeatures(features: unknown[]): string {
  let mermaid = 'graph TD\n';

  features.forEach((feature, fIndex) => {
    // biome-ignore lint/suspicious/noExplicitAny: complex feature structure
    const feat = feature as any;
    const fNode = `f${fIndex}`;
    mermaid += `  ${fNode}["Feature: ${escapeString(feat.path)}"]\n`;

    let lastNode = fNode;
    let _scenarioCount = 0;

    // biome-ignore lint/suspicious/noExplicitAny: complex step type
    feat.featureSteps.forEach((step: any, sIndex: number) => {
      // Skip start markers if redundant, or stylize them
      if (step.action.actionName === 'feature') return; // Handled by root

      const sNode = `f${fIndex}s${sIndex}`;
      let label = step.in;
      let style = '';

      if (step.action.actionName === 'scenario') {
        _scenarioCount++;
        label = `Scenario: ${step.in}`;
        style = 'style ' + sNode + ' fill:#e1f5fe,stroke:#01579b,stroke-width:2px';
      } else {
        // Truncate long steps
        if (label.length > 40) label = label.substring(0, 37) + '...';
      }

      mermaid += `  ${sNode}["${escapeString(label)}"]\n`;
      if (lastNode) {
        mermaid += `  ${lastNode} --> ${sNode}\n`;
      }

      if (style) {
        mermaid += `  ${style}\n`;
      }

      lastNode = sNode;
    });
  });

  return mermaid;
}

function escapeString(str: string) {
  return str
    .replace(/"/g, "'")
    .replace(/`/g, "'")
    .replace(/\n/g, ' ');
}
