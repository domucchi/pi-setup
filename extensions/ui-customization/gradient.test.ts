import { describe, expect, it } from "vitest";
import { gradientLine, gradientLogo, parseRgb } from "./src/gradient.ts";

describe("parseRgb", () => {
  it("extracts rgb from a truecolor SGR string", () => {
    expect(parseRgb("\x1b[38;2;235;188;186m")).toEqual([235, 188, 186]);
  });
  it("returns null for non-truecolor ansi", () => {
    expect(parseRgb("\x1b[35m")).toBeNull();
  });
});

describe("gradientLine", () => {
  it("colors glyphs and preserves spaces", () => {
    const out = gradientLine("A B", 0, 1, [255, 0, 0], [0, 0, 255]);
    expect(out).toContain("\x1b[38;2;");
    // The space between A and B is untouched.
    expect(out).toContain(" ");
  });
});

describe("gradientLogo", () => {
  const logo = ["AB", "CD"];
  it("gradients when truecolor and colors parse", () => {
    const out = gradientLogo(
      logo,
      "\x1b[38;2;255;0;0m",
      "\x1b[38;2;0;0;255m",
      true,
      (l) => `flat:${l}`,
    );
    expect(out[0]).toContain("\x1b[38;2;");
    expect(out[0]).not.toContain("flat:");
  });
  it("falls back to flat when not truecolor", () => {
    const out = gradientLogo(logo, "\x1b[38;2;255;0;0m", "\x1b[38;2;0;0;255m", false, (l) => `flat:${l}`);
    expect(out).toEqual(["flat:AB", "flat:CD"]);
  });
  it("falls back to flat when colors can't be parsed", () => {
    const out = gradientLogo(logo, "\x1b[31m", "\x1b[34m", true, (l) => `flat:${l}`);
    expect(out).toEqual(["flat:AB", "flat:CD"]);
  });
});
