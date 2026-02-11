# State Shape Testing Instructions

## What Was Changed

**File**:  (line 232)

Changed state_4 and state_5 from rank 0 ([]) to rank 1 ([1]):



## Why This Change

The error message was clear once interpreted correctly:
- "Invalid rank for input: state_4 Got: 0 Expected: 1"
- This means: you gave rank 0 (scalar with shape []), but rank 1 was expected
- Solution: change to rank 1 shape = [1]

## How to Test

### Option 1: Quick Test (state_4 only)
Open in browser: 

This tests state_4=[1] with other states as [1] as well. If successful, state_4 is correct.

### Option 2: Comprehensive Test (all states)
Open in browser: 

This tests all 18 states. The error message will guide next fixes.

### Option 3: Manual Testing


## Understanding Error Messages

### Type 1: Rank Error

Means: You have rank 0 (shape []), need rank 1 (shape [1])
- Fix: Change shape from [] to [1]

### Type 2: Rank Error (Higher Rank)

Means: You have rank 1 (shape [1]), need rank 5 (shape [?, ?, ?, ?, ?])
- Fix: Change shape from [1] to [2, 1, 1000, 16, 64]

### Type 3: Dimension Value Error

Means: First dimension has value 1, but should be 0
- Fix: Change [1] to [0]

### Type 4: Type Error

Means: State needs int64 dtype, not float32
- Fix: Add to int64States set

## Next Steps After Confirming state_4

1. Look at error for state_5, state_6, etc.
2. Apply fixes one by one based on error type
3. Re-test after each fix
4. Continue until all 18 states work

## Files to Check

- Main implementation:  (line 227-236)
- Test files created:
  -  - Quick test
  -  - Comprehensive test

## Expected Success

When all states are correct, the model should run and output:
- : predictions
-  through : new state values for next iteration
