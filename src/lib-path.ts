import os from "node:os";
import { suffix } from "bun:ffi";
import path from "node:path";
import { mkdir, rename, rm } from "node:fs/promises";
import packageJson from "../package.json";

export function buildLocalLibName(libName: string, libSuffix: string): string {
  const base = `${libName}.${libSuffix}`;
  return libSuffix === "dll" ? base : `lib${base}`;
}

export function buildRemoteLibName(libName: string, libSuffix: string, arch: string): string {
  if (libSuffix === "so") return `${arch}.${libSuffix}`;
  if (libSuffix === "dll") return `${libName}.${arch}.${libSuffix}`;
  return buildLocalLibName(libName, libSuffix);
}

export function buildRemoteUrl(baseUri: string, remoteLibName: string): string {
  const base = baseUri.endsWith("/") ? baseUri : baseUri + "/";
  return new URL(remoteLibName, base).href;
}

export const DEV_BUILD_ENV_VAR = "FLOWSCRIPTER_HASH_NATIVE_DEV_BUILD";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");

export function buildDevLibPath(
  fullLibName: string,
  env: Record<string, string | undefined> = process.env,
  packageRoot: string = PACKAGE_ROOT,
): string | undefined {
  if (env[DEV_BUILD_ENV_VAR] !== "1") return undefined;
  return path.join(packageRoot, "target", "release", fullLibName);
}

export const SHASUM_SUFFIX = ".shasum";

/** Extract the hex sha256 digest from `sha256sum` style content ("<digest>  <name>"). */
export function parseShasum(content: string): string {
  const digest = content.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error("Invalid shasum content: expected a hex sha256 digest");
  }
  return digest;
}

export async function sha256File(filePath: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(filePath).bytes());
  return hasher.digest("hex");
}

async function fetchOk(fetchFn: typeof fetch, url: string): Promise<Response> {
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  return response;
}

async function writeAtomic(destPath: string, data: string, tmpSuffix: string) {
  const tmpPath = `${destPath}.${tmpSuffix}.tmp`;
  try {
    await Bun.write(tmpPath, data);
    await rename(tmpPath, destPath);
  } catch (e) {
    await rm(tmpPath, { force: true });
    throw e;
  }
}

/** True if the file exists and matches the digest in its sibling `.shasum` file. */
async function isInstalledAndValid(libPath: string): Promise<boolean> {
  try {
    const expected = parseShasum(await Bun.file(libPath + SHASUM_SUFFIX).text());
    return (await sha256File(libPath)) === expected;
  } catch {
    return false;
  }
}

export interface GetLibPathOptions {
  fetchFn?: typeof fetch;
  installedLibFolder?: string;
  baseUri?: string;
  env?: Record<string, string | undefined>;
}

/**
 * Resolve the path to a verified native library, downloading it from the release if needed.
 *
 * Downloaded and previously installed libraries are checked against the `.shasum` file
 * published as a sibling of the library in the release. Throws if verification fails.
 */
export async function getLibPath(libName: string, options: GetLibPathOptions = {}) {
  const {
    fetchFn = fetch,
    installedLibFolder = path.join(os.homedir(), ".flowscripter", "lib"),
    baseUri = packageJson.ffiLibBaseUri,
    env = process.env,
  } = options;
  const fullLibName = buildLocalLibName(libName, suffix);

  // opt-in: look in the package's own release build location
  const builtLibPath = buildDevLibPath(fullLibName, env);
  if (builtLibPath && (await Bun.file(builtLibPath).exists())) {
    return builtLibPath;
  }

  // look in release installed location
  const installedLibPath = path.join(installedLibFolder, fullLibName);
  if (await isInstalledAndValid(installedLibPath)) {
    return installedLibPath;
  }

  const remoteLibName = buildRemoteLibName(libName, suffix, process.arch);
  const remoteLibUrl = buildRemoteUrl(baseUri, remoteLibName);

  await mkdir(installedLibFolder, { recursive: true });

  const expected = parseShasum(await (await fetchOk(fetchFn, remoteLibUrl + SHASUM_SUFFIX)).text());

  const tmpSuffix = `${process.pid}-${crypto.randomUUID()}`;
  const tmpLibPath = `${installedLibPath}.${tmpSuffix}.tmp`;
  try {
    await Bun.write(tmpLibPath, await fetchOk(fetchFn, remoteLibUrl));
    const actual = await sha256File(tmpLibPath);
    if (actual !== expected) {
      throw new Error(
        `Checksum mismatch for ${remoteLibUrl}: expected ${expected} but downloaded ${actual}`,
      );
    }
    await writeAtomic(installedLibPath + SHASUM_SUFFIX, `${expected}  ${fullLibName}\n`, tmpSuffix);
    await rename(tmpLibPath, installedLibPath);
  } catch (e) {
    await rm(tmpLibPath, { force: true });
    throw e;
  }

  return installedLibPath;
}
