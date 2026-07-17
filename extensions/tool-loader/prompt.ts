export const TOOL_NAME = "load_tools";

export const DESCRIPTION = `Load deferred tool groups when a task needs them. Tools stay active for the rest of the session.

Available capability groups:
- browser — interactive headless-browser inspection and operation
- terminals — background processes, servers, watchers, and logs
- subagents — delegated child agents and their lifecycle
- workflows — multi-agent workflow execution and status
- web — web search and static page fetching

Request every capability needed for the task in one call.`;

export const PROMPT_SNIPPET =
  "Load deferred browser, terminal, subagent, workflow, or web tools when needed";

export const PROMPT_GUIDELINES = [
  "Use load_tools before attempting a task that needs browser, background-terminal, subagent, workflow, or web capabilities that are not currently available.",
  "Load terminals and use bg_start for long-running commands such as dev servers, watchers, builds, and tails; background terminals have no stdin.",
  "Load browser for interactive pages and local web apps; load web for static pages, documentation, and current web research.",
  "Load subagents for bounded delegated work whose full output would clutter the parent context or for parallel independent tasks.",
  "Load workflows only when the user explicitly requests multi-agent orchestration or approves a proposal to run it.",
];

export const PARAMETER_DESCRIPTION =
  "Capability groups to activate. Request all groups needed for the task in one call.";
