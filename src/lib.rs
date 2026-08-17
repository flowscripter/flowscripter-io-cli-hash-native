//! # flowscripter-io-cli-hash-native
//!
//! Rust-backed sha256 hasher exposed via Bun FFI, for demonstrating a
//! zero-copy `ChunkRef` handoff outside of `pluggable-io-framework` itself.
//! `init`/`update`/`final` mirrors OpenSSL's `EVP_Digest*` shape: `update`
//! is called once per chunk with a raw pointer into JS- or Rust-owned
//! memory, `final` copies out the (small, 32-byte) digest and frees the
//! context.

use sha2::{Digest, Sha256};

pub const DIGEST_LENGTH: usize = 32;

/// Opaque hashing context. Only ever accessed through the `hasher_*`
/// functions below - never dereferenced directly by callers.
pub struct HasherContext {
    hasher: Sha256,
}

/// Allocates a new hashing context. Must be freed by a matching call to
/// [`hasher_final`].
#[no_mangle]
pub extern "C" fn hasher_init() -> *mut HasherContext {
    Box::into_raw(Box::new(HasherContext {
        hasher: Sha256::new(),
    }))
}

/// Feeds `len` bytes starting at `data` into the hash. `data` may point
/// into memory owned by either the JS heap (via `bun:ffi`'s `ptr()`) or
/// Rust-owned memory (e.g. a future Rust-backed source's `NativeChunk`) -
/// this function reads it in place either way, without copying.
///
/// # Safety
/// `ctx` must be a valid pointer returned by [`hasher_init`] and not yet
/// passed to [`hasher_final`]. `data` must be valid for reads of `len`
/// bytes for the duration of this call.
#[no_mangle]
pub extern "C" fn hasher_update(ctx: *mut HasherContext, data: *const u8, len: usize) {
    if ctx.is_null() || data.is_null() {
        return;
    }
    let context = unsafe { &mut *ctx };
    let slice = unsafe { std::slice::from_raw_parts(data, len) };
    context.hasher.update(slice);
}

/// Finalizes the hash, copies the `DIGEST_LENGTH`-byte digest into the
/// caller-supplied `out` buffer, and frees `ctx` - `ctx` must not be used
/// again after this call.
///
/// # Safety
/// `ctx` must be a valid pointer returned by [`hasher_init`], not
/// previously passed to `hasher_final`. `out` must be valid for writes of
/// `DIGEST_LENGTH` bytes.
#[no_mangle]
pub extern "C" fn hasher_final(ctx: *mut HasherContext, out: *mut u8) {
    if ctx.is_null() || out.is_null() {
        return;
    }
    let context = unsafe { Box::from_raw(ctx) };
    let digest = context.hasher.finalize();
    unsafe {
        std::ptr::copy_nonoverlapping(digest.as_ptr(), out, digest.len());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_known_vector() {
        let ctx = hasher_init();
        let data = b"hello";
        hasher_update(ctx, data.as_ptr(), data.len());
        let mut out = [0u8; DIGEST_LENGTH];
        hasher_final(ctx, out.as_mut_ptr());

        let expected =
            hex::decode("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")
                .unwrap();
        assert_eq!(out.to_vec(), expected);
    }

    #[test]
    fn hashes_across_multiple_updates() {
        let ctx = hasher_init();
        hasher_update(ctx, b"hel".as_ptr(), 3);
        hasher_update(ctx, b"lo".as_ptr(), 2);
        let mut out = [0u8; DIGEST_LENGTH];
        hasher_final(ctx, out.as_mut_ptr());

        let expected =
            hex::decode("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")
                .unwrap();
        assert_eq!(out.to_vec(), expected);
    }
}
