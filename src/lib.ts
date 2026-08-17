import { dlopen, FFIType, ptr, type Pointer } from "bun:ffi";
import { getLibPath } from "./lib-path.ts";

const libPath = await getLibPath("flowscripter_io_cli_hash_native");

const { symbols } = dlopen(libPath, {
  hasher_init: {
    args: [],
    returns: FFIType.ptr,
  },
  hasher_update: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u64],
    returns: FFIType.void,
  },
  hasher_final: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.void,
  },
});

export const DIGEST_LENGTH = 32;

/**
 * Incremental sha256 hasher backed by a Rust `cdylib` via `bun:ffi`.
 *
 * `update()` passes a raw pointer into the caller's buffer straight to the
 * synchronous Rust FFI call - a zero-copy handoff for a JS-owned
 * `Uint8Array`, or a pure pointer passthrough for an already Rust-owned
 * buffer (`updatePointer()`).
 */
export class Sha256Hasher {
  #ctx: Pointer;
  #finalized = false;

  constructor() {
    const ctx = symbols.hasher_init();
    if (!ctx) {
      throw new Error("Failed to initialise native hasher context");
    }
    this.#ctx = ctx;
  }

  /** Feed a JS-owned buffer into the hash - zero-copy via `bun:ffi`'s `ptr()`. */
  update(data: Uint8Array): void {
    if (this.#finalized) {
      throw new Error("Hasher has already been finalized");
    }
    symbols.hasher_update(this.#ctx, ptr(data), BigInt(data.byteLength));
  }

  /**
   * Feed a chunk already referenced by a raw pointer/length (e.g. a
   * Rust-owned `NativeChunk`) into the hash - no copy at all, not even the
   * `ptr()` lookup `update()` needs for a JS-owned buffer.
   */
  updatePointer(dataPtr: number, length: number): void {
    if (this.#finalized) {
      throw new Error("Hasher has already been finalized");
    }
    symbols.hasher_update(this.#ctx, dataPtr as unknown as Pointer, BigInt(length));
  }

  /** Finalizes the hash and returns the digest. The hasher cannot be reused after this. */
  final(): Uint8Array {
    if (this.#finalized) {
      throw new Error("Hasher has already been finalized");
    }
    this.#finalized = true;
    const out = new Uint8Array(DIGEST_LENGTH);
    symbols.hasher_final(this.#ctx, ptr(out));
    return out;
  }
}
