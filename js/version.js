// __COMMIT_SHA__ and __DEPLOY_TIME__ are substituted by the deploy workflow
// (.github/workflows/deploy.yml) on every push, so this always reflects the
// commit that's actually live. Locally they're just placeholders.
export const COMMIT_SHA = "__COMMIT_SHA__";
export const DEPLOY_TIME = "__DEPLOY_TIME__";

export function renderVersion(elements) {
  const isDeployed = !COMMIT_SHA.startsWith("__");
  const text = isDeployed ? `${COMMIT_SHA.slice(0, 7)} · ${DEPLOY_TIME}` : "dev build";
  elements.forEach((el) => {
    el.textContent = text;
  });
}
