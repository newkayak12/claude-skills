# Notes

Changed: `distance` in packages/geo/src/index.mjs and packages/geo/test/distance.test.mjs.

`npm test` at the root before my change: red. The units test "kmToMiles converts 100 km to about 62.14
miles" in packages/units already fails (the factor is 0.62). That is a baseline failure unrelated to this
change; I left packages/units alone.
`npm test` after: the same single failure in packages/units; the geo tests pass.
