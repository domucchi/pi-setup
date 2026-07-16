import { describe, expect, it } from "vitest";
import { OutputBuffer, tailText } from "./src/output.ts";

describe("OutputBuffer", () => {
  it("keeps everything under the cap", () => {
    const buffer = new OutputBuffer(100);
    buffer.append("hello ");
    buffer.append("world");
    expect(buffer.text()).toBe("hello world");
    expect(buffer.totalBytes).toBe(11);
    expect(buffer.truncatedBytes).toBe(0);
  });

  it("drops oldest chunks when over the cap", () => {
    const buffer = new OutputBuffer(10);
    buffer.append("aaaaa");
    buffer.append("bbbbb");
    buffer.append("cc");
    expect(buffer.text()).toBe("bbbbbcc");
    expect(buffer.truncatedBytes).toBe(5);
    expect(buffer.totalBytes).toBe(12);
  });

  it("trims a single oversized chunk to its tail", () => {
    const buffer = new OutputBuffer(4);
    buffer.append("abcdefgh");
    expect(buffer.text()).toBe("efgh");
    expect(buffer.truncatedBytes).toBe(4);
  });

  it("does not split multibyte characters when trimming", () => {
    const buffer = new OutputBuffer(5);
    buffer.append("aaaa😀"); // emoji is 4 bytes; cut lands mid-codepoint
    const text = buffer.text();
    expect(text).not.toContain("�");
    expect(text.endsWith("😀")).toBe(true);
  });
});

describe("tailText", () => {
  it("returns short text unchanged", () => {
    expect(tailText("abc", 10)).toBe("abc");
  });

  it("keeps the tail and marks truncation", () => {
    expect(tailText("0123456789", 4)).toBe("…[truncated]…6789");
  });
});
