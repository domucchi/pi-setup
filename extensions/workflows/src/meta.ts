import { parse } from "acorn";

export interface WorkflowPhase {
  title: string;
  detail?: string;
  model?: string;
}

export interface WorkflowMeta {
  name: string;
  description: string;
  whenToUse?: string;
  phases?: WorkflowPhase[];
}

/**
 * Evaluate an acorn AST node that must be a pure literal: primitives,
 * arrays, and plain objects with static keys. Anything dynamic —
 * identifiers, calls, templates, spreads, computed keys — fails closed.
 */
function evaluateLiteral(node: any): unknown {
  switch (node.type) {
    case "Literal":
      return node.value;
    case "ArrayExpression":
      return node.elements.map((el: any) => {
        if (!el || el.type === "SpreadElement") {
          throw new Error("meta arrays must not contain holes or spreads");
        }
        return evaluateLiteral(el);
      });
    case "ObjectExpression": {
      const out: Record<string, unknown> = {};
      for (const prop of node.properties) {
        if (prop.type !== "Property" || prop.computed || prop.kind !== "init") {
          throw new Error("meta objects must use plain static properties");
        }
        const key =
          prop.key.type === "Identifier"
            ? prop.key.name
            : prop.key.type === "Literal"
              ? String(prop.key.value)
              : null;
        if (key === null) throw new Error("meta keys must be static");
        out[key] = evaluateLiteral(prop.value);
      }
      return out;
    }
    case "UnaryExpression":
      if (node.operator === "-" && node.argument.type === "Literal") {
        return -(node.argument.value as number);
      }
      throw new Error("meta must be a pure literal");
    default:
      throw new Error(`meta must be a pure literal (found ${node.type})`);
  }
}

/** Replace [start, end) with spaces, preserving newlines/line numbers. */
function blank(source: string, start: number, end: number) {
  const segment = source
    .slice(start, end)
    .replace(/[^\n]/g, " ");
  return source.slice(0, start) + segment + source.slice(end);
}

/**
 * Extract and validate `export const meta = {...}` and return the
 * source with that declaration blanked (line numbers preserved).
 * Throws with a model-actionable message on any violation.
 */
export function extractMeta(source: string): {
  meta: WorkflowMeta;
  body: string;
} {
  let program: any;
  try {
    // The body later runs wrapped in an async IIFE, so top-level
    // return/await are legal in workflow scripts.
    program = parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
    });
  } catch (error) {
    throw new Error(
      `Workflow script has a syntax error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let metaNode: any;
  let exportNode: any;
  for (const node of program.body) {
    if (node.type === "ImportDeclaration") {
      throw new Error("Workflow scripts cannot use import statements.");
    }
    if (
      node.type === "ExportNamedDeclaration" &&
      node.declaration?.type === "VariableDeclaration"
    ) {
      const declarator = node.declaration.declarations.find(
        (d: any) => d.id.type === "Identifier" && d.id.name === "meta",
      );
      if (declarator) {
        if (node.declaration.kind !== "const") {
          throw new Error("meta must be declared with `export const`.");
        }
        metaNode = declarator.init;
        exportNode = node;
        continue;
      }
    }
    if (node.type.startsWith("Export")) {
      throw new Error(
        "Workflow scripts may only export `const meta`; everything else is the script body.",
      );
    }
  }

  if (!metaNode) {
    throw new Error(
      "Workflow script must begin with `export const meta = { name, description, ... }`.",
    );
  }
  if (metaNode.type !== "ObjectExpression") {
    throw new Error("meta must be an object literal.");
  }

  const meta = evaluateLiteral(metaNode) as Record<string, unknown>;
  if (typeof meta.name !== "string" || !meta.name.trim()) {
    throw new Error("meta.name must be a non-empty string.");
  }
  if (typeof meta.description !== "string" || !meta.description.trim()) {
    throw new Error("meta.description must be a non-empty string.");
  }
  if (meta.phases !== undefined) {
    if (
      !Array.isArray(meta.phases) ||
      meta.phases.some(
        (p) => typeof p !== "object" || p === null || typeof (p as any).title !== "string",
      )
    ) {
      throw new Error("meta.phases must be an array of { title, ... } objects.");
    }
  }

  return {
    meta: meta as unknown as WorkflowMeta,
    body: blank(source, exportNode.start, exportNode.end),
  };
}
