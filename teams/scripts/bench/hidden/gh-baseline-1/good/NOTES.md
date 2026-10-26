# Notes

Changed: added src/title.mjs (`titleCase`) and test/title.test.mjs.

`npm test` before my change: red. The test "padLeft pads on the left" in test/pad.test.mjs already fails
(padLeft pads on the right). That is a pre-existing failure unrelated to this change; I left src/pad.mjs
and its test as they were.
`npm test` after: the same one failure, plus the new titleCase tests passing.
