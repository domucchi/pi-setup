import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadForgeConfig } from "./src/config.ts";

const saved = { gl: process.env.PI_GITLAB_HOSTS, gh: process.env.PI_GITHUB_HOSTS };

afterEach(() => {
  process.env.PI_GITLAB_HOSTS = saved.gl;
  process.env.PI_GITHUB_HOSTS = saved.gh;
  if (saved.gl === undefined) delete process.env.PI_GITLAB_HOSTS;
  if (saved.gh === undefined) delete process.env.PI_GITHUB_HOSTS;
});

describe("loadForgeConfig", () => {
  it("reads comma-separated env vars, lowercased", () => {
    process.env.PI_GITLAB_HOSTS = "git.example.com, GitLab.Internal ";
    process.env.PI_GITHUB_HOSTS = "ghe.corp";
    const config = loadForgeConfig(mkdtempSync(path.join(tmpdir(), "gi-")));
    expect(config.gitlabHosts).toEqual(["git.example.com", "gitlab.internal"]);
    expect(config.githubHosts).toEqual(["ghe.corp"]);
  });

  it("reads git-info.json and merges it with env", () => {
    delete process.env.PI_GITHUB_HOSTS;
    process.env.PI_GITLAB_HOSTS = "env.gitlab";
    const dir = mkdtempSync(path.join(tmpdir(), "gi-"));
    writeFileSync(
      path.join(dir, "git-info.json"),
      JSON.stringify({ gitlabHosts: ["git.example.com"], githubHosts: ["ghe.corp"] }),
    );
    const config = loadForgeConfig(dir);
    expect(config.gitlabHosts).toEqual(["env.gitlab", "git.example.com"]);
    expect(config.githubHosts).toEqual(["ghe.corp"]);
  });

  it("returns empty lists when nothing is configured", () => {
    delete process.env.PI_GITLAB_HOSTS;
    delete process.env.PI_GITHUB_HOSTS;
    const config = loadForgeConfig(mkdtempSync(path.join(tmpdir(), "gi-")));
    expect(config).toEqual({ githubHosts: [], gitlabHosts: [] });
  });
});
