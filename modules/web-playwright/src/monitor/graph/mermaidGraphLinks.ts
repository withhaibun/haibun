export function getEnvVarLinks(featureSteps) {
  const links = [];
  featureSteps.forEach((step, stepIndex) => {
    if (step.action && step.action.named && step.action.named.what) {
      const match = /^\{(.+?)\}$/.exec(step.action.named.what);
      if (match) {
        links.push({ stepIndex, envVar: match[1] });
      }
    }
  });
  return links;
}

export function getScenarioVars(featureSteps) {
  const links = [];
  featureSteps.forEach((step, stepIndex) => {
    if (step.action && step.action.named && step.action.named.what) {
      const what = step.action.named.what;
      if (!/^\{.+\}$/.test(what)) {
        const varName = what.replace(/^"|"$/g, '');
        links.push({ stepIndex, varName });
      }
    }
  });
  return links;
}
