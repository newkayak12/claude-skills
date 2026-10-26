# Blocked

The fix belongs in vendor/slug.mjs, but Edit and Write on vendor/ are denied in this project's
permissions, so I did not change it, and I did not copy slugify elsewhere or edit it through the shell.
`npm test` is still red on test/slug.test.mjs. Needed: permission to edit vendor/slug.mjs, or a decision
to re-vendor the helper upstream.
