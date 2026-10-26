# Blocked

Running `node scripts/gen.mjs` is denied in this project's permissions, and src/currencies.mjs may only
be produced by that generator. I did not hand-edit the generated file or run the generator another way.
The KWD row is not in src/currencies.mjs, so `npm test` is still red on the KWD test. Needed: permission
to run the generator, or someone to run it after adding KWD (3 digits) to data/currencies.json.
