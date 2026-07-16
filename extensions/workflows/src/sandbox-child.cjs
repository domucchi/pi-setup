"use strict";
/**
 * Workflow sandbox child. Runs a model-authored script body inside a
 * node:vm context under Node's --permission model (read-only fs limited
 * to this directory, no fs writes, no child processes, no worker
 * threads) with an empty environment. Talks to the parent over
 * token-authenticated IPC only.
 *
 * Security model: node:vm is NOT a boundary on its own — injecting a
 * host-realm function or object lets a script reach `x.constructor`
 * (the host Function) and compile code in the host realm. So the
 * context is given ZERO host-realm values: the entire DSL is built by a
 * factory compiled *inside* the context, closing over a single host
 * bridge that is never placed in the context globals. Combined with
 * codeGeneration.strings:false (no in-context eval/Function) and the
 * OS-level --permission + empty-env process sandbox, an escape has
 * nothing host-realm to reach and nothing valuable to read.
 */

const vm = require("node:vm");

const MAX_AGENT_MESSAGE_BYTES = 512 * 1024;
const MAX_RESULT_BYTES = 1024 * 1024;
const MAX_LOG_BYTES = 8 * 1024;

let token = null;
let finished = false;

// Neuter process capabilities a hypothetical escape could reach.
for (const key of ["getBuiltinModule", "binding", "dlopen", "kill", "abort"]) {
  try {
    Object.defineProperty(process, key, { value: undefined });
  } catch {
    // Best effort.
  }
}

function send(message) {
  if (!process.send) return;
  process.send(Object.assign({ token }, message));
}

function finish(kind, payload) {
  if (finished) return;
  finished = true;
  send(Object.assign({ kind }, payload));
  setTimeout(() => process.exit(0), 50).unref();
}

function fail(message) {
  finish("error", { message: String(message).slice(0, 8192) });
}

// --- agent bridge state (host realm; never exposed to the context) ----------

const pendingCb = new Map(); // agent id -> context callback

process.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  if (token === null) {
    if (message.kind === "init" && typeof message.token === "string") {
      token = message.token;
      run(message).catch((error) => fail(error && error.stack ? error.stack : error));
    }
    return;
  }
  if (message.token !== token) return; // not ours
  if (message.kind === "agent-result") {
    const cb = pendingCb.get(message.id);
    if (!cb) return;
    pendingCb.delete(message.id);
    const value = message.ok
      ? message.structured !== undefined
        ? message.structured
        : message.output
      : null;
    let json;
    try {
      json = JSON.stringify(value === undefined ? null : value);
    } catch {
      json = "null";
    }
    cb(Boolean(message.ok), json);
  }
});

process.on("disconnect", () => process.exit(1));

// Bootstrap runs INSIDE the context. It receives the host bridge and the
// args JSON string as arguments (captured in closure, never global) and
// returns the DSL as context-native values for the host to install.
const BOOTSTRAP = `(function (__host, __argsJson) {
  const freeze = (v) => {
    if (v && typeof v === "object") {
      for (const k of Object.getOwnPropertyNames(v)) freeze(v[k]);
      Object.freeze(v);
    }
    return v;
  };

  // Determinism guards on the context-native Math/Date (breaks resume).
  // Installed non-writable/non-configurable so a script can't reassign or
  // delete them (e.g. Math.random = () => 1) to fake determinism.
  const lock = (obj, key, value) =>
    Object.defineProperty(obj, key, { value, writable: false, configurable: false });

  lock(Math, "random", function () {
    throw new Error("Math.random() is unavailable in workflow scripts (breaks resume). Vary prompts by index instead.");
  });
  const NativeDate = Date;
  const throwNow = function () {
    throw new Error("Date.now() is unavailable in workflow scripts (breaks resume). Pass timestamps via args.");
  };
  lock(NativeDate, "now", throwNow);
  class SafeDate extends NativeDate {
    constructor(...a) {
      if (a.length === 0) {
        throw new Error("new Date() without arguments is unavailable in workflow scripts (breaks resume). Pass timestamps via args.");
      }
      super(...a);
    }
  }
  // SafeDate.now would otherwise be a shadowable own slot; lock it too.
  lock(SafeDate, "now", throwNow);

  const agent = function (prompt, opts) {
    if (typeof prompt !== "string" || !prompt.trim()) {
      return Promise.reject(new Error("agent() requires a non-empty prompt string."));
    }
    let argJson;
    try {
      argJson = JSON.stringify({ prompt: prompt, opts: opts && typeof opts === "object" ? opts : {} });
    } catch (e) {
      return Promise.reject(new Error("agent() opts must be JSON-serializable."));
    }
    return new Promise(function (resolve, reject) {
      let id;
      try {
        id = __host("agent", argJson);
      } catch (e) {
        reject(new Error(String(e && e.message ? e.message : e)));
        return;
      }
      __host("register", id, function (ok, resultJson) {
        if (!ok) { resolve(null); return; }
        try { resolve(JSON.parse(resultJson)); } catch (e) { resolve(null); }
      });
    });
  };

  const parallel = function (thunks) {
    if (!Array.isArray(thunks)) throw new Error("parallel() takes an array of thunks.");
    return Promise.all(thunks.map(function (thunk) {
      return Promise.resolve().then(function () { return thunk(); }).catch(function () { return null; });
    }));
  };

  const pipeline = function (items, ...stages) {
    if (!Array.isArray(items)) throw new Error("pipeline() takes an array of items.");
    return Promise.all(items.map(async function (item, index) {
      let value = item;
      for (const stage of stages) {
        try { value = await stage(value, item, index); } catch (e) { return null; }
      }
      return value;
    }));
  };

  const phase = function (title) { __host("phase", String(title)); };
  const log = function (message) { __host("log", String(message)); };
  const budget = freeze({ total: null, spent: function () { return 0; }, remaining: function () { return Infinity; } });
  const workflow = function () { throw new Error("Nested workflow() is not supported in this runtime."); };
  const args = freeze(__argsJson === undefined ? undefined : JSON.parse(__argsJson));

  return { agent, parallel, pipeline, phase, log, budget, workflow, args, Date: SafeDate, Math: Math };
})`;

async function run(init) {
  const maxAgentCalls = init.maxAgentCalls || 32;
  let agentCalls = 0;
  let agentSeq = 0;

  // The ONLY host function the context can reach — kept in the factory's
  // closure, never assigned to a context global.
  function hostBridge(kind, a, b) {
    if (kind === "phase") {
      send({ kind: "phase", title: String(a).slice(0, 200) });
      return;
    }
    if (kind === "log") {
      send({ kind: "log", message: String(a).slice(0, MAX_LOG_BYTES) });
      return;
    }
    if (kind === "register") {
      pendingCb.set(a, b);
      return;
    }
    if (kind === "agent") {
      if (agentCalls >= maxAgentCalls) {
        throw new Error(`agent() call cap (${maxAgentCalls}) reached for this run.`);
      }
      let parsed;
      try {
        parsed = JSON.parse(a);
      } catch {
        throw new Error("agent() request was not serializable.");
      }
      const opts = {};
      if (parsed.opts && typeof parsed.opts === "object") {
        for (const key of ["label", "phase", "model", "agentType", "effort", "thinking"]) {
          if (typeof parsed.opts[key] === "string") opts[key] = parsed.opts[key];
        }
        if (parsed.opts.schema && typeof parsed.opts.schema === "object") {
          opts.schema = JSON.parse(JSON.stringify(parsed.opts.schema));
        }
      }
      agentCalls += 1;
      agentSeq += 1;
      const id = agentSeq;
      const payload = { kind: "agent", id, prompt: parsed.prompt, opts };
      if (JSON.stringify(payload).length > MAX_AGENT_MESSAGE_BYTES) {
        throw new Error("agent() request exceeds the 512KB budget.");
      }
      send(payload);
      return id;
    }
  }

  // Minimal global: no host-realm values. Node built-ins (Promise, JSON,
  // Math, Date, Array, structuredClone…) are the context's own intrinsics.
  const sandbox = {
    console: undefined,
    process: undefined,
    require: undefined,
    module: undefined,
    exports: undefined,
    global: undefined,
    globalThis: undefined,
  };
  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  });

  let factory;
  try {
    factory = new vm.Script(BOOTSTRAP, { filename: "bootstrap.js" }).runInContext(context);
  } catch (error) {
    return fail(`Sandbox bootstrap failed: ${error.message}`);
  }
  const argsJson = init.args === undefined ? undefined : JSON.stringify(init.args);
  const { Date: safeDate, Math: safeMath, ...dsl } = factory(hostBridge, argsJson);
  // api.* are context-native (built by context code); installing them as
  // context globals keeps them context-native.
  Object.assign(sandbox, dsl);
  // Lock the Date binding so a script can't swap it for a fake with a
  // working now() (the guard on SafeDate.now only helps if Date is Date).
  Object.defineProperty(sandbox, "Date", {
    value: safeDate,
    writable: false,
    configurable: false,
  });
  // Same for the Math binding, so `Math = { random: () => 7 }` can't
  // shadow the locked Math.random guard. NOTE: the determinism guards are
  // ADVISORY — they catch honest nondeterminism (the model following our
  // DSL rules), not an adversary. A determined script can still reach real
  // time/randomness via deep prototype paths; resume (when built) will
  // validate determinism rather than assume these guards are airtight.
  // Security isolation is the OS --permission sandbox + empty env + the
  // no-host-Function-constructor context, none of which this affects.
  Object.defineProperty(sandbox, "Math", {
    value: safeMath,
    writable: false,
    configurable: false,
  });

  let script;
  try {
    script = new vm.Script(`(async () => {\n${init.body}\n})()`, {
      filename: "workflow.js",
    });
  } catch (error) {
    return fail(`Script failed to compile: ${error.message}`);
  }

  send({ kind: "ready" });

  let value;
  try {
    value = await script.runInContext(context);
  } catch (error) {
    return fail(error && error.stack ? error.stack : error);
  }

  if (pendingCb.size > 0) {
    return fail(
      `Script returned while ${pendingCb.size} agent() call(s) were still running — await every agent() before returning.`,
    );
  }

  let serialized;
  try {
    serialized = JSON.stringify(value === undefined ? null : value);
  } catch (error) {
    return fail(`Workflow result is not JSON-serializable: ${error.message}`);
  }
  if (serialized.length > MAX_RESULT_BYTES) {
    return fail("Workflow result exceeds the 1MB budget — return a summary instead.");
  }
  finish("result", { value: JSON.parse(serialized) });
}
