# Request problem found before implementing

The test "mean of two and four" expects mean([2, 4]) to be 4. That is wrong: the arithmetic mean
of 2 and 4 is 3. The request says the tests must not be edited and mean must stay the arithmetic
mean, so npm test cannot go green without breaking one of the two rules.

Decision asked of the person: correct the test to 3, or say mean is not the arithmetic mean.
I changed neither the test nor src/stats.mjs.
