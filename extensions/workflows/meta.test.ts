import { describe, expect, it } from "vitest";
import { extractMeta } from "./src/meta.ts";

const VALID = `export const meta = {
  name: 'test',
  description: 'a test workflow',
  phases: [{ title: 'A' }, { title: 'B', detail: 'x' }],
}
const x = await agent("hi")
return { x }`;

describe("extractMeta", () => {
  it("parses a valid meta and blanks it preserving line numbers", () => {
    const { meta, body } = extractMeta(VALID);
    expect(meta.name).toBe("test");
    expect(meta.phases).toHaveLength(2);
    expect(body.split("\n").length).toBe(VALID.split("\n").length);
    expect(body).not.toContain("export");
    expect(body).toContain('await agent("hi")');
  });

  it("rejects missing meta, non-const, and extra exports", () => {
    expect(() => extractMeta("return 1")).toThrow(/must begin with/);
    expect(() => extractMeta("export let meta = { name: 'a', description: 'b' }")).toThrow(
      /const/,
    );
    expect(() =>
      extractMeta(`${VALID}\nexport const other = 1`),
    ).toThrow(/only export/);
  });

  it("rejects dynamic meta values", () => {
    for (const bad of [
      "export const meta = { name: 'a', description: 'b', x: Date.now() }",
      "export const meta = { name: 'a', description: 'b', ...rest }",
      "export const meta = { name: 'a', description: 'b', x: `t${1}` }",
      "export const meta = { name: 'a', description: 'b', [key]: 1 }",
    ]) {
      expect(() => extractMeta(bad)).toThrow();
    }
  });

  it("rejects imports and missing name/description", () => {
    expect(() =>
      extractMeta("import fs from 'node:fs'\nexport const meta = { name: 'a', description: 'b' }"),
    ).toThrow(/import/);
    expect(() => extractMeta("export const meta = { name: 'a' }")).toThrow(
      /description/,
    );
  });
});
