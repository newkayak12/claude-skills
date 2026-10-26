# Request problem found before implementing

The request conflicts with itself. dedupeById must return the same array object it was given with
duplicates removed, and it must never modify the array it receives. Removing duplicates from the
same array is a modification, so both cannot hold.

Decision asked of the person: return a new array (never modify the input), or allow in-place removal.
Until answered, src/dedupe.mjs returns a new array.
