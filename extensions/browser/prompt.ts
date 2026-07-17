/** All model-facing text for the browser extension. */

export const BROWSER_GOTO_DESCRIPTION =
  "Open a URL in the session's headless browser and return an accessibility " +
  "snapshot of the page. Elements carry [ref=eN] references — pass those refs " +
  "to browser_click / browser_type. localhost and LAN dev servers are allowed. " +
  "Use web_fetch instead when you only need to READ a static page (much cheaper); " +
  "use the browser for interactive pages, web apps under development, and anything " +
  "that needs clicking, typing, or a screenshot.";

export const BROWSER_SNAPSHOT_DESCRIPTION =
  "Re-capture the accessibility snapshot of the current page (fresh [ref=eN] " +
  "references). Use after the page changed on its own (navigation, async load) — " +
  "click/type already return a fresh snapshot.";

export const BROWSER_CLICK_DESCRIPTION =
  "Click an element on the current page by its [ref=eN] reference from the LATEST " +
  "snapshot (stale refs error). Returns a fresh snapshot after the click.";

export const BROWSER_TYPE_DESCRIPTION =
  "Fill a form element (by [ref=eN] from the latest snapshot) with text, " +
  "optionally pressing Enter to submit. Returns a fresh snapshot.";

export const BROWSER_SCREENSHOT_DESCRIPTION =
  "Take a PNG screenshot of the current page — rendered directly in the " +
  "terminal for the user. Use it to SHOW something (visual bugs, layout, " +
  "styling); use snapshots for reading structure and finding elements.";

export const BROWSER_CONSOLE_DESCRIPTION =
  "Read the page's console log (captured since the browser opened, including " +
  "uncaught errors). First stop when a page misbehaves.";

export const BROWSER_EVALUATE_DESCRIPTION =
  "Evaluate a JavaScript expression in the page and return its JSON result — " +
  "the escape hatch for reading state the snapshot doesn't show " +
  "(e.g. 'document.title', 'localStorage.getItem(\"token\")', '(() => {...})()').";

export const BROWSER_REQUESTS_DESCRIPTION =
  "Read the page's network log (method, URL, status; captured since the browser " +
  "opened). Filter by URL substring to find specific API calls.";

export const BROWSER_CLOSE_DESCRIPTION =
  "Close the browser and free its resources. It relaunches automatically on the " +
  "next browser_goto. Call when you are done with a browsing task.";

export const BROWSER_PROMPT_SNIPPET =
  "Drive a real headless browser (goto/snapshot/click/type/screenshot) for web-app inspection.";

export const BROWSER_PROMPT_GUIDELINES = [
  "For reading static pages use web_fetch; reach for the browser_* tools when a page is interactive, is a web app you are developing (localhost is allowed), or when the user should SEE it (browser_screenshot).",
  "Always act on [ref=eN] references from the most recent snapshot — refs from older snapshots are stale after any page change.",
  "For heavy browser work (network mocking, tracing, auth/storage state, device emulation, multi-tab) write a playwright script instead of tool calls — load the browser-debugging skill for recipes.",
];

export const PARAMETER_DESCRIPTIONS = {
  url: "The http(s) URL to open. localhost / LAN addresses are fine.",
  ref: "Element reference from the latest snapshot, e.g. 'e12'.",
  element:
    "Short human-readable description of the element (shown to the user), e.g. 'Login button'.",
  text: "The text to fill into the element (replaces existing content).",
  pressEnter: "Press Enter after filling (submits most forms). Default false.",
  fullPage: "Capture the full scrollable page instead of the viewport. Default false.",
  consoleLimit: "How many trailing console entries to return. Default 30.",
  expression:
    "JavaScript expression evaluated in the page context. Wrap multi-statement code as an IIFE: '(() => { ...; return x; })()'.",
  requestsFilter: "Only include requests whose URL contains this substring.",
  requestsLimit: "How many trailing requests to return. Default 40.",
};
