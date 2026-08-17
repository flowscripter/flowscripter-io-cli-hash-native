use flowscripter_io_cli_hash_native::{hasher_final, hasher_init, hasher_update, DIGEST_LENGTH};

#[test]
fn hashes_known_vector_through_the_public_extern_functions() {
    let ctx = hasher_init();
    let data = b"hello";
    hasher_update(ctx, data.as_ptr(), data.len());
    let mut out = [0u8; DIGEST_LENGTH];
    hasher_final(ctx, out.as_mut_ptr());

    let expected: [u8; DIGEST_LENGTH] = [
        0x2c, 0xf2, 0x4d, 0xba, 0x5f, 0xb0, 0xa3, 0x0e, 0x26, 0xe8, 0x3b, 0x2a, 0xc5, 0xb9, 0xe2,
        0x9e, 0x1b, 0x16, 0x1e, 0x5c, 0x1f, 0xa7, 0x42, 0x5e, 0x73, 0x04, 0x33, 0x62, 0x93, 0x8b,
        0x98, 0x24,
    ];
    assert_eq!(out, expected);
}
