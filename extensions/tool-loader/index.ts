import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  CAPABILITIES,
  initialTools,
  isDeferredTool,
  toolsForCapabilities,
} from "./src/groups.ts";
import {
  DESCRIPTION,
  PARAMETER_DESCRIPTION,
  PROMPT_GUIDELINES,
  PROMPT_SNIPPET,
  TOOL_NAME,
} from "./prompt.ts";

export default function toolLoader(pi: ExtensionAPI) {
  pi.registerTool({
    name: TOOL_NAME,
    label: "Load Tools",
    description: DESCRIPTION,
    promptSnippet: PROMPT_SNIPPET,
    promptGuidelines: PROMPT_GUIDELINES,
    parameters: Type.Object({
      capabilities: Type.Array(StringEnum(CAPABILITIES), {
        description: PARAMETER_DESCRIPTION,
        minItems: 1,
        maxItems: CAPABILITIES.length,
        uniqueItems: true,
      }),
    }),
    async execute(_id, params) {
      const available = pi.getAllTools().map((tool) => tool.name);
      const matches = toolsForCapabilities(available, params.capabilities);
      const active = pi.getActiveTools();
      const added = matches.filter((name) => !active.includes(name));

      if (added.length > 0) {
        pi.setActiveTools([...new Set([...active, ...added])]);
      }

      const text =
        matches.length === 0
          ? `No tools are registered for: ${params.capabilities.join(", ")}.`
          : added.length === 0
            ? `Tools already active: ${matches.join(", ")}.`
            : `Loaded tools: ${added.join(", ")}.`;

      return {
        content: [{ type: "text" as const, text }],
        details: { capabilities: params.capabilities, matches, added },
      };
    },
  });

  pi.on("session_start", (_event, ctx) => {
    const registered = new Set(pi.getAllTools().map((tool) => tool.name));
    const restored = new Set<string>();
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message" || entry.message.role !== "toolResult") continue;
      for (const name of entry.message.addedToolNames ?? []) {
        if (registered.has(name) && isDeferredTool(name)) restored.add(name);
      }
    }
    pi.setActiveTools(
      initialTools(pi.getActiveTools(), TOOL_NAME, [...restored]),
    );
  });
}
