import os from "node:os";
import { suffix } from "bun:ffi";
import path from "node:path";
import { mkdir } from "node:fs/promises";
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

export async function getLibPath(libName: string) {
  const fullLibName = buildLocalLibName(libName, suffix);

  // opt-in: look in the package's own release build location
  const builtLibPath = buildDevLibPath(fullLibName);
  let exists = false;

  if (builtLibPath) {
    exists = await Bun.file(builtLibPath).exists();
    if (exists) {
      return builtLibPath;
    }
  }

  // look in release installed location
  const installedLibFolder = path.join(os.homedir(), ".flowscripter", "lib");
  const installedLibPath = path.join(installedLibFolder, fullLibName);
  const installedLibFile = Bun.file(installedLibPath);

  exists = await installedLibFile.exists();

  if (exists) {
    return installedLibPath;
  }

  const remoteLibName = buildRemoteLibName(libName, suffix, process.arch);
  const remotePath = buildRemoteUrl(packageJson.ffiLibBaseUri, remoteLibName);

  await mkdir(installedLibFolder, { recursive: true });

  try {
    const result = await fetch(remotePath);

    await Bun.write(installedLibPath, result);
  } catch (e) {
    console.error(`Failed to download ${remotePath} to ${installedLibPath}: ${e}`);
  }

  return installedLibPath;
}
