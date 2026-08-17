# flowscripter-io-cli-hash-native

[![version](https://img.shields.io/github/v/release/flowscripter/flowscripter-io-cli-hash-native?sort=semver)](https://github.com/flowscripter/flowscripter-io-cli-hash-native/releases)
[![build](https://img.shields.io/github/actions/workflow/status/flowscripter/flowscripter-io-cli-hash-native/release-bun-rust-library.yml)](https://github.com/flowscripter/flowscripter-io-cli-hash-native/actions/workflows/release-bun-rust-library.yml)
[![docs](https://img.shields.io/badge/docs-API-blue)](https://flowscripter.github.io/flowscripter-io-cli-hash-native/index.html)
[![rust doc](https://img.shields.io/docsrs/flowscripter_io_cli_hash_native)](https://docs.rs/flowscripter_io_cli_hash_native)
[![license: MIT](https://img.shields.io/github/license/flowscripter/flowscripter-io-cli-hash-native)](https://github.com/flowscripter/flowscripter-io-cli-hash-native/blob/main/LICENSE)

> Rust-backed sha256 hasher for flowscripter-io-cli, exposed via Bun FFI.

## Bun Module Usage

Add the module:

`bun add @flowscripter/flowscripter-io-cli-hash-native`

Use the module:

```typescript
import { Sha256Hasher } from "@flowscripter/flowscripter-io-cli-hash-native";

const hasher = new Sha256Hasher();
hasher.update(new TextEncoder().encode("hello"));
const digest = hasher.final();
```

## Development

Install dependencies:

`bun install`

Build (produces `dist/` for Node.js and TypeScript consumers; Bun uses raw source directly):

`bun run build`

Test:

`cargo test`

`cargo build --release && bun test`

Format:

`cargo fmt && bunx oxfmt`

Lint:

`bunx oxlint index.ts src/ tests/`

Generate HTML API Documentation:

`bunx typedoc index.ts`

## Documentation

### Overview

`Sha256Hasher` wraps a native Rust `sha2` implementation behind three `extern "C"` functions (`hasher_init`, `hasher_update`, `hasher_final`) loaded via `bun:ffi`'s `dlopen`.

`update()` accepts a JS-owned `Uint8Array` and passes a raw pointer straight into the synchronous Rust call using `bun:ffi`'s `ptr()` - no further copy is made once the bytes are in JS memory.

`updatePointer()` accepts an already-raw pointer/length pair - for example a chunk that originated from a native source and never had a JS-owned copy - and passes it straight through to the Rust call with no copy at all.

The resulting 32-byte digest is copied back to JS by `final()`, which is negligible in size regardless of how much data was hashed.

### API

Link to auto-generated API docs:

[API Documentation](https://flowscripter.github.io/flowscripter-io-cli-hash-native/index.html)

## License

MIT © Flowscripter
