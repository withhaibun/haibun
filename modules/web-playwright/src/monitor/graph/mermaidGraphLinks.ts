// Helper to extract environment variable links from feature steps
export function getEnvVarLinks(featureSteps) {
  const links = [];
  featureSteps.forEach((step, stepIndex) => {
    if (step.action && step.action.named && step.action.named.what) {
      // env var: {env_var} (curly braces)
      const match = /^\{(.+?)\}$/.exec(step.action.named.what);
      if (match) {
        links.push({ stepIndex, envVar: match[1] });
      }
    }
  });
  return links;
}

// Helper to extract scenario variable links from feature steps
export function getScenarioVars(featureSteps) {
  const links = [];
  featureSteps.forEach((step, stepIndex) => {
    if (step.action && step.action.named && step.action.named.what) {
      // scenario var: quoted or unquoted, but not curly braces
      const what = step.action.named.what;
      if (!/^\{.+\}$/.test(what)) {
        // Remove quotes if present
        const varName = what.replace(/^"|"$/g, '');
        links.push({ stepIndex, varName });
      }
    }
  });
  return links;
}
