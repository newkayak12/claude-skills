# Notes

Changed: added src/sum.mjs (`sumColumn`) and test/sum.test.mjs.

`npm test` before my change: red. The test "sample file lists three rows" in test/sample.test.mjs already
fails because data/sample.csv is not in the repository (ENOENT). That is a pre-existing failure unrelated
to this change; I did not add the file or touch that test.
`npm test` after: the same single failure; the new sumColumn tests pass.
