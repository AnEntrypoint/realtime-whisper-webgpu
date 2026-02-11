# State Shape Discovery Fix - state_4 Rank Correction

## Change Made

File:  (line 232)

### Before


### After


## Rationale

The error messages were contradictory but now understood:

1. **First error**: "state_4 dimensions index: 0 Got: 1 Expected: 0"
   - This meant: dimension 0 had VALUE 1 when expecting VALUE 0
   - Interpretation: shape [1] was given, but shape [0] was expected
   - This was confusing because it seemed like a dimension mismatch

2. **Current error**: "Invalid rank for input: state_4 Got: 0 Expected: 1"
   - This clearly means: rank 0 (scalar) was given, but rank 1 was expected
   - Solution: change state_4 from [] (rank 0) to [1] (rank 1)

## Key Learning: Understanding ONNX Error Messages

- **Rank error**: "Invalid rank ... Got: X Expected: Y" = wrong number of dimensions
  - Fix: change the shape to have Y dimensions
  
- **Dimension value error**: "dimensions index: 0 Got: 1 Expected: 0" = wrong SIZE of dimension
  - Fix: change dimension value from 1 to 0 in that position

## Testing

Created test file: 

To test:
1. Open  in browser
2. If it succeeds, state_4=[1] is correct
3. If it fails, error message will indicate what state_5-17 need

## Next Steps

After confirming state_4 works:
1. Test state_5-17 one by one
2. For each state that fails, read the error message carefully
3. Apply fixes based on error type:
   - "Invalid rank": fix the number of dimensions
   - "Got X Expected Y": fix the dimension value
4. Continue until all 18 states work correctly

## Current Known Shapes

- state_0: [2, 1, 1000, 16, 64] - Rank 5 transformer state
- state_1: [0] - Empty tensor
- state_2: [1] - Rank 1, requires int64 dtype
- state_3: [2, 1, 1000, 16, 64] - Rank 5 transformer state
- state_4: [1] - **FIXED** - Rank 1
- state_5: [1] - Rank 1 (tentative)
- state_6-17: [] (rank 0) - Need testing
