import { describe, expect, it } from "vitest";
import { buildFdArgs, buildRgArgs } from "./src/args.ts";
import { capOutput } from "./src/cap.ts";

describe("buildFdArgs", () => {
  it("defaults to match-everything with the default limit", () => {
    expect(buildFdArgs({})).toEqual([
      "--color=never",
      "--max-results",
      "1000",
      ".",
    ]);
  });

  it("maps every option", () => {
    expect(
      buildFdArgs({
        pattern: "*.test.ts",
        path: "src",
        type: "file",
        extension: "ts",
        glob: true,
        hidden: true,
        max_depth: 3,
        limit: 50,
      }),
    ).toEqual([
      "--color=never",
      "--glob",
      "--hidden",
      "--type",
      "file",
      "--extension",
      "ts",
      "--max-depth",
      "3",
      "--max-results",
      "50",
      "*.test.ts",
      "src",
    ]);
  });
});

describe("buildRgArgs", () => {
  it("defaults to smart-case with line numbers", () => {
    expect(buildRgArgs({ pattern: "foo" })).toEqual([
      "--color=never",
      "--line-number",
      "--no-heading",
      "--smart-case",
      "--max-count",
      "100",
      "--",
      "foo",
    ]);
  });

  it("guards dash-leading patterns behind --", () => {
    const args = buildRgArgs({ pattern: "-rf" });
    expect(args.indexOf("--")).toBe(args.length - 2);
    expect(args.at(-1)).toBe("-rf");
  });

  it("maps case sensitivity explicitly both ways", () => {
    expect(buildRgArgs({ pattern: "x", case_sensitive: true })).toContain(
      "--case-sensitive",
    );
    expect(buildRgArgs({ pattern: "x", case_sensitive: false })).toContain(
      "--ignore-case",
    );
  });

  it("maps filters and context", () => {
    const args = buildRgArgs({
      pattern: "x",
      glob: "*.ts",
      file_type: "ts",
      fixed_strings: true,
      hidden: true,
      context: 2,
      limit: 10,
    });
    expect(args).toContain("--fixed-strings");
    expect(args).toContain("--hidden");
    expect(args.join(" ")).toContain("--glob *.ts");
    expect(args.join(" ")).toContain("--type ts");
    expect(args.join(" ")).toContain("--context 2");
    expect(args.join(" ")).toContain("--max-count 10");
  });
});

describe("capOutput", () => {
  it("passes small output through untouched", () => {
    const capped = capOutput("a\nb");
    expect(capped).toEqual({ text: "a\nb", truncated: false, totalLines: 2 });
  });

  it("caps by line count", () => {
    const capped = capOutput("a\nb\nc\nd", 2);
    expect(capped.text).toBe("a\nb");
    expect(capped.truncated).toBe(true);
    expect(capped.totalLines).toBe(4);
  });

  it("caps by bytes on whole lines", () => {
    const capped = capOutput("aaaa\nbbbb\ncccc", 100, 10);
    expect(capped.text).toBe("aaaa\nbbbb");
    expect(capped.truncated).toBe(true);
  });
});
