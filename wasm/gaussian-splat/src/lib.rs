//! Validation for a bounded subset of the raw 32-byte Gaussian splat format.

use std::cell::RefCell;

const RECORD_SIZE: usize = 32;
const MAX_INPUT: usize = 4 * 1024 * 1024;

thread_local! {
    static INPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

/// Reserve a single input buffer. A subsequent call invalidates the prior loan.
/// The host reacquires the memory view after reserve and copies exactly `len` bytes.
#[unsafe(no_mangle)]
pub extern "C" fn reserve(len: u32) -> *mut u8 {
    INPUT.with(|input| {
        let mut input = input.borrow_mut();
        input.clear();
        let len = len as usize;
        if len == 0 || len > MAX_INPUT || input.try_reserve_exact(len).is_err() {
            return std::ptr::null_mut();
        }
        input.resize(len, 0);
        input.as_mut_ptr()
    })
}

/// Return the record count, or -1 for length and -2 for invalid geometry.
#[unsafe(no_mangle)]
pub extern "C" fn validate() -> i32 {
    INPUT.with(|input| {
        let input = input.borrow();
        if input.is_empty() || !input.len().is_multiple_of(RECORD_SIZE) {
            return -1;
        }
        for record in input.as_chunks::<RECORD_SIZE>().0 {
            for (index, bytes) in record[..24].as_chunks::<4>().0.iter().enumerate() {
                let value = f32::from_le_bytes(*bytes);
                if !value.is_finite() || (index >= 3 && value <= 0.0) {
                    return -2;
                }
            }
            if record[28..32] == [128; 4] {
                return -2;
            }
        }
        (input.len() / RECORD_SIZE) as i32
    })
}
