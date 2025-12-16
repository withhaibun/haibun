import { TResolvedFeaturesArtifact } from '../types';

// type TResolvedFeature = TResolvedFeaturesArtifact['resolvedFeatures'][number];

export function getMermaidFromResolvedFeatures(features: any[]): string {
  let mermaid = 'graph TD\n';

  features.forEach((feature, fIndex) => {
    const fNode = `f${fIndex}`;
    mermaid += `  ${fNode}[Feature: ${escape(feature.path)}]\n`;

    let lastNode = fNode;
    let scenarioCount = 0;

    feature.featureSteps.forEach((step: any, sIndex: number) => {
      // Skip start markers if redundant, or stylize them
      if (step.action.actionName === 'feature') return; // Handled by root

      const sNode = `f${fIndex}s${sIndex}`;
      let label = step.in;
      let style = '';

      if (step.action.actionName === 'scenario') {
        scenarioCount++;
        label = `Scenario: ${step.in}`;
        style = 'style ' + sNode + ' fill:#e1f5fe,stroke:#01579b,stroke-width:2px';
      } else {
        // Truncate long steps
        if (label.length > 40) label = label.substring(0, 37) + '...';
      }

      mermaid += `  ${sNode}[${escape(label)}]\n`;
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

function escape(str: string) {
  return str.replace(/["[\]]/g, '');
}
