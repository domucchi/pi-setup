export const CAPABILITIES = [
  "browser",
  "terminals",
  "subagents",
  "workflows",
  "web",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const matches: Record<Capability, (name: string) => boolean> = {
  browser: (name) => name.startsWith("browser_"),
  terminals: (name) => name.startsWith("bg_"),
  subagents: (name) => name.startsWith("subagent_"),
  workflows: (name) => name === "workflow" || name === "workflow_status",
  web: (name) => name === "web_search" || name === "web_fetch",
};

export function isDeferredTool(name: string) {
  return CAPABILITIES.some((capability) => matches[capability](name));
}

export function initialTools(
  activeTools: readonly string[],
  loaderName: string,
  restoredTools: readonly string[] = [],
) {
  return [
    ...new Set([
      ...activeTools.filter((name) => !isDeferredTool(name)),
      ...restoredTools.filter(isDeferredTool),
      loaderName,
    ]),
  ];
}

export function toolsForCapabilities(
  allToolNames: readonly string[],
  capabilities: readonly Capability[],
) {
  const selected = new Set(capabilities);
  return allToolNames.filter((name) =>
    CAPABILITIES.some(
      (capability) => selected.has(capability) && matches[capability](name),
    ),
  );
}
