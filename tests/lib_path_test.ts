import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  buildDevLibPath,
  buildLocalLibName,
  buildRemoteLibName,
  buildRemoteUrl,
  DEV_BUILD_ENV_VAR,
} from "../src/lib-path.ts";

describe("buildLocalLibName", () => {
  test("Linux .so gets lib prefix", () => {
    expect(buildLocalLibName("foo", "so")).toBe("libfoo.so");
  });

  test("macOS .dylib gets lib prefix", () => {
    expect(buildLocalLibName("foo", "dylib")).toBe("libfoo.dylib");
  });

  test("Windows .dll has no lib prefix", () => {
    expect(buildLocalLibName("foo", "dll")).toBe("foo.dll");
  });
});

describe("buildRemoteLibName", () => {
  test("Linux x64", () => {
    expect(buildRemoteLibName("foo", "so", "x64")).toBe("x64.so");
  });

  test("Linux arm64", () => {
    expect(buildRemoteLibName("foo", "so", "arm64")).toBe("arm64.so");
  });

  test("macOS uses local naming (no arch suffix)", () => {
    expect(buildRemoteLibName("foo", "dylib", "arm64")).toBe("libfoo.dylib");
    expect(buildRemoteLibName("foo", "dylib", "x64")).toBe("libfoo.dylib");
  });

  test("Windows x64", () => {
    expect(buildRemoteLibName("foo", "dll", "x64")).toBe("foo.x64.dll");
  });

  test("Windows arm64", () => {
    expect(buildRemoteLibName("foo", "dll", "arm64")).toBe("foo.arm64.dll");
  });
});

describe("buildRemoteUrl", () => {
  test("base without trailing slash", () => {
    expect(buildRemoteUrl("https://example.com/releases/v1.0", "x64.so")).toBe(
      "https://example.com/releases/v1.0/x64.so",
    );
  });

  test("base with trailing slash", () => {
    expect(buildRemoteUrl("https://example.com/releases/v1.0/", "x64.so")).toBe(
      "https://example.com/releases/v1.0/x64.so",
    );
  });

  test("does not corrupt https:// into https:/", () => {
    const url = buildRemoteUrl("https://github.com/org/repo/releases/download/v1.0", "x64.so");
    expect(url).toBe("https://github.com/org/repo/releases/download/v1.0/x64.so");
    expect(url.startsWith("https://")).toBe(true);
  });

  test("real-world example matches expected release asset URL", () => {
    const url = buildRemoteUrl(
      "https://github.com/flowscripter/template-bun-rust-library/releases/download/v1.1.5",
      "x64.so",
    );
    expect(url).toBe(
      "https://github.com/flowscripter/template-bun-rust-library/releases/download/v1.1.5/x64.so",
    );
  });
});

describe("buildDevLibPath", () => {
  test("is disabled by default", () => {
    expect(buildDevLibPath("libfoo.so", {})).toBeUndefined();
  });

  test("is disabled for values other than 1", () => {
    expect(buildDevLibPath("libfoo.so", { [DEV_BUILD_ENV_VAR]: "true" })).toBeUndefined();
  });

  test("resolves relative to the package root when enabled", () => {
    expect(buildDevLibPath("libfoo.so", { [DEV_BUILD_ENV_VAR]: "1" }, "/pkg")).toBe(
      path.join("/pkg", "target", "release", "libfoo.so"),
    );
  });

  test("default package root is absolute and independent of the working directory", () => {
    const original = process.cwd();
    try {
      process.chdir("/tmp");
      const result = buildDevLibPath("libfoo.so", { [DEV_BUILD_ENV_VAR]: "1" });
      expect(path.isAbsolute(result!)).toBe(true);
      expect(result!.startsWith("/tmp/target")).toBe(false);
    } finally {
      process.chdir(original);
    }
  });
});
