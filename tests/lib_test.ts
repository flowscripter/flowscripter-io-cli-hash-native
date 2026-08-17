import { describe, expect, test } from "bun:test";
import { ptr } from "bun:ffi";
import { DIGEST_LENGTH, Sha256Hasher } from "../src/lib.ts";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const SHA256_OF_HELLO = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

describe("Sha256Hasher", () => {
  test("matches the known sha256 digest of a single update", () => {
    const hasher = new Sha256Hasher();
    hasher.update(new TextEncoder().encode("hello"));
    const digest = hasher.final();

    expect(digest.byteLength).toBe(DIGEST_LENGTH);
    expect(toHex(digest)).toBe(SHA256_OF_HELLO);
  });

  test("matches the known digest across multiple updates", () => {
    const hasher = new Sha256Hasher();
    hasher.update(new TextEncoder().encode("hel"));
    hasher.update(new TextEncoder().encode("lo"));
    expect(toHex(hasher.final())).toBe(SHA256_OF_HELLO);
  });

  test("matches for an empty input", () => {
    const hasher = new Sha256Hasher();
    const digest = hasher.final();
    expect(toHex(digest)).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  test("throws if used after final()", () => {
    const hasher = new Sha256Hasher();
    hasher.final();
    expect(() => hasher.update(new TextEncoder().encode("x"))).toThrow();
  });

  test("updatePointer hashes the same as update, given the same bytes via ptr()", () => {
    const data = new TextEncoder().encode("hello");
    const hasher = new Sha256Hasher();
    hasher.updatePointer(ptr(data), data.byteLength);
    expect(toHex(hasher.final())).toBe(SHA256_OF_HELLO);
  });
});
