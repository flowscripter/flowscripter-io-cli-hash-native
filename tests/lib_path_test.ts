import { describe, expect, test } from "bun:test";
import { suffix } from "bun:ffi";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildDevLibPath,
  buildLocalLibName,
  buildRemoteLibName,
  buildRemoteUrl,
  DEV_BUILD_ENV_VAR,
  getLibPath,
  parseShasum,
  sha256File,
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
      process.chdir(os.tmpdir());
      const result = buildDevLibPath("libfoo.so", { [DEV_BUILD_ENV_VAR]: "1" });
      expect(path.isAbsolute(result!)).toBe(true);
      expect(result!.startsWith(path.join(process.cwd(), "target"))).toBe(false);
    } finally {
      process.chdir(original);
    }
  });
});

const LIB_NAME = "foo";
const BASE = "https://example.com/rel";
const LIB_BYTES = new TextEncoder().encode("native-library-bytes");
const LIB_DIGEST = new Bun.CryptoHasher("sha256").update(LIB_BYTES).digest("hex");

function remoteLibUrl(): string {
  return buildRemoteUrl(BASE, buildRemoteLibName(LIB_NAME, suffix, process.arch));
}

function fakeFetch(routes: Record<string, Response>, calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const response = routes[url];
    return response ? response.clone() : new Response("not found", { status: 404 });
  }) as typeof fetch;
}

async function tmpFolder(): Promise<string> {
  return path.join(await mkdtemp(path.join(os.tmpdir(), "hash-native-lib-")), "lib");
}

describe("parseShasum", () => {
  test("parses sha256sum style content", () => {
    expect(parseShasum(`${LIB_DIGEST}  libfoo.so\n`)).toBe(LIB_DIGEST);
  });

  test("parses a bare digest and normalises case", () => {
    expect(parseShasum(LIB_DIGEST.toUpperCase())).toBe(LIB_DIGEST);
  });

  test("rejects invalid content", () => {
    expect(() => parseShasum("")).toThrow();
    expect(() => parseShasum("<html>not found</html>")).toThrow();
    expect(() => parseShasum("abc123")).toThrow();
  });
});

describe("getLibPath", () => {
  const good = () => ({
    [remoteLibUrl()]: new Response(LIB_BYTES),
    [remoteLibUrl() + ".shasum"]: new Response(`${LIB_DIGEST}  x\n`),
  });

  test("downloads, verifies and installs the library with a sibling shasum", async () => {
    const folder = await tmpFolder();
    const result = await getLibPath(LIB_NAME, {
      fetchFn: fakeFetch(good()),
      installedLibFolder: folder,
      baseUri: BASE,
      env: {},
    });
    expect(result).toBe(path.join(folder, buildLocalLibName(LIB_NAME, suffix)));
    expect(await sha256File(result)).toBe(LIB_DIGEST);
    expect(parseShasum(await Bun.file(result + ".shasum").text())).toBe(LIB_DIGEST);
    expect((await readdir(folder)).sort()).toEqual(
      [path.basename(result), path.basename(result) + ".shasum"].sort(),
    );
  });

  test("does not download again when the installed library verifies", async () => {
    const folder = await tmpFolder();
    const options = { installedLibFolder: folder, baseUri: BASE, env: {} };
    await getLibPath(LIB_NAME, { ...options, fetchFn: fakeFetch(good()) });
    const calls: string[] = [];
    await getLibPath(LIB_NAME, { ...options, fetchFn: fakeFetch({}, calls) });
    expect(calls).toEqual([]);
  });

  test("replaces an installed library that does not match its shasum", async () => {
    const folder = await tmpFolder();
    const options = { installedLibFolder: folder, baseUri: BASE, env: {} };
    const result = await getLibPath(LIB_NAME, { ...options, fetchFn: fakeFetch(good()) });
    await Bun.write(result, "corrupted");
    await getLibPath(LIB_NAME, { ...options, fetchFn: fakeFetch(good()) });
    expect(await sha256File(result)).toBe(LIB_DIGEST);
  });

  test("replaces an installed library that has no shasum", async () => {
    const folder = await tmpFolder();
    await Bun.write(path.join(folder, buildLocalLibName(LIB_NAME, suffix)), "unverified");
    const result = await getLibPath(LIB_NAME, {
      fetchFn: fakeFetch(good()),
      installedLibFolder: folder,
      baseUri: BASE,
      env: {},
    });
    expect(await sha256File(result)).toBe(LIB_DIGEST);
  });

  test("rejects a digest mismatch and leaves nothing installed", async () => {
    const folder = await tmpFolder();
    const routes = good();
    routes[remoteLibUrl()] = new Response("tampered");
    await expect(
      getLibPath(LIB_NAME, {
        fetchFn: fakeFetch(routes),
        installedLibFolder: folder,
        baseUri: BASE,
        env: {},
      }),
    ).rejects.toThrow(/Checksum mismatch/);
    expect(await readdir(folder)).toEqual([]);
  });

  test("rejects a non-OK library response", async () => {
    const folder = await tmpFolder();
    const routes = good();
    routes[remoteLibUrl()] = new Response("error page", { status: 500 });
    await expect(
      getLibPath(LIB_NAME, {
        fetchFn: fakeFetch(routes),
        installedLibFolder: folder,
        baseUri: BASE,
        env: {},
      }),
    ).rejects.toThrow(/HTTP 500/);
    expect(await readdir(folder)).toEqual([]);
  });

  test("rejects a missing shasum", async () => {
    const folder = await tmpFolder();
    const routes = good();
    delete routes[remoteLibUrl() + ".shasum"];
    await expect(
      getLibPath(LIB_NAME, {
        fetchFn: fakeFetch(routes),
        installedLibFolder: folder,
        baseUri: BASE,
        env: {},
      }),
    ).rejects.toThrow(/HTTP 404/);
    expect(await readdir(folder)).toEqual([]);
  });

  test("rejects a truncated download", async () => {
    const folder = await tmpFolder();
    const routes = good();
    routes[remoteLibUrl()] = new Response(LIB_BYTES.slice(0, 5));
    await expect(
      getLibPath(LIB_NAME, {
        fetchFn: fakeFetch(routes),
        installedLibFolder: folder,
        baseUri: BASE,
        env: {},
      }),
    ).rejects.toThrow(/Checksum mismatch/);
    expect(await readdir(folder)).toEqual([]);
  });
});
