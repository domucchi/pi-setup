"use strict";
/**
 * Workflow sandbox child. Runs a model-authored script body inside a
 * node:vm context with code generation disabled, under Node's
 * --permission model (read-only fs limited to this directory, no net,
 * no child processes). Talks to the parent over token-authenticated
 * IPC only. Defense-in-depth: even a vm escape lands in a process that
 * can't write, spawn, or dial out.
 */

const vm = require("node:vm");

const MAX_AGENT_MESSAGE_BYTES = 512 * 1024;
const MAX_RESULT_BYTES = 1024 * 1024;
const MAX_LOG_BYTES = 8 * 1024;

let token = null;
let finished = false;
const pending = new Map(); // agent id -> resolve

// Neuter process capabilities a hypothetical vm escape could reach.
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
  // Give the IPC channel a beat to flush, then exit regardless.
  setTimeout(() => process.exit(0), 50).unref();
  process.disconnect && setTimeout(() => {
    try {
      process.disconnect();
    } catch {}
  }, 20).unref();
}

function fail(message) {
  finish("error", { message: String(message).slice(0, 8192) });
}

process.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  if (token === null) {
    if (message.kind === "init" && typeof message.token === "string") {
      token = message.token;
      run(message).catch((error) => fail(error && error.stack ? error.stack : error));
    }
    return;
  }
  if (message.token !== token) return; // not ours — ignore
  if (message.kind === "agent-result") {
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  }
});

process.on("disconnect", () => process.exit(1));

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze(value[key]);
    }
    Object.freeze(value);
  }
  return value;
}

async function run(init) {
  const maxAgentCalls = init.maxAgentCalls || 32;
  let agentCalls = 0;
  let agentSeq = 0;

  function agent(prompt, opts) {
    if (typeof prompt !== "string" || !prompt.trim()) {
      return Promise.reject(new Error("agent() requires a non-empty prompt string."));
    }
    if (agentCalls >= maxAgentCalls) {
      return Promise.reject(
        new Error(`agent() call cap (${maxAgentCalls}) reached for this run.`),
      );
    }
    agentCalls += 1;
    agentSeq += 1;
    const id = agentSeq;
    const cleanOpts = {};
    if (opts && typeof opts === "object") {
      for (const key of ["label", "phase", "model", "agentType", "effort", "thinking"]) {
        if (typeof opts[key] === "string") cleanOpts[key] = opts[key];
      }
      if (opts.schema && typeof opts.schema === "object") {
        cleanOpts.schema = JSON.parse(JSON.stringify(opts.schema));
      }
    }
    const payload = { kind: "agent", id, prompt, opts: cleanOpts };
    if (JSON.stringify(payload).length > MAX_AGENT_MESSAGE_BYTES) {
      return Promise.reject(new Error("agent() request exceeds the 512KB budget."));
    }
    return new Promise((resolve) => {
      pending.set(id, (outcome) => {
        if (outcome.ok) {
          resolve(outcome.structured !== undefined ? outcome.structured : outcome.output);
        } else {
          // Failed agents resolve to null (Claude Code semantics) so
          // scripts filter with .filter(Boolean) instead of try/catch.
          resolve(null);
        }
      });
      send(payload);
    });
  }

  async function parallel(thunks) {
    if (!Array.isArray(thunks)) throw new Error("parallel() takes an array of thunks.");
    return Promise.all(
      thunks.map((thunk) =>
        Promise.resolve()
          .then(() => thunk())
          .catch(() => null),
      ),
    );
  }

  async function pipeline(items, ...stages) {
    if (!Array.isArray(items)) throw new Error("pipeline() takes an array of items.");
    return Promise.all(
      items.map(async (item, index) => {
        let value = item;
        for (const stage of stages) {
          try {
            value = await stage(value, item, index);
          } catch {
            return null;
          }
        }
        return value;
      }),
    );
  }

  function phase(title) {
    send({ kind: "phase", title: String(title).slice(0, 200) });
  }

  function log(message) {
    send({ kind: "log", message: String(message).slice(0, MAX_LOG_BYTES) });
  }

  const budget = Object.freeze({
    total: null,
    spent: () => 0,
    remaining: () => Infinity,
  });

  function workflow() {
    throw new Error("Nested workflow() is not supported in this runtime.");
  }

  // Determinism guards — these would break future resume/replay.
  const SafeMath = Object.create(Math);
  SafeMath.random = () => {
    throw new Error(
      "Math.random() is unavailable in workflow scripts (breaks resume). Vary prompts by index instead.",
    );
  };
  class SafeDate extends Date {
    constructor(...args) {
      if (args.length === 0) {
        throw new Error(
          "new Date() without arguments is unavailable in workflow scripts (breaks resume). Pass timestamps via args.",
        );
      }
      super(...args);
    }
    static now() {
      throw new Error(
        "Date.now() is unavailable in workflow scripts (breaks resume). Pass timestamps via args.",
      );
    }
  }

  const sandbox = {
    agent,
    parallel,
    pipeline,
    phase,
    log,
    budget,
    workflow,
    args: deepFreeze(structuredClone(init.args ?? undefined)),
    Math: SafeMath,
    Date: SafeDate,
    console: undefined,
    process: undefined,
    require: undefined,
    module: undefined,
    globalThis: undefined,
  };

  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
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

  if (pending.size > 0) {
    return fail(
      `Script returned while ${pending.size} agent() call(s) were still running — await every agent() before returning.`,
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
