// Shard 2 of 3 of test-taskmanager.mjs (see lib/tm-shard.mjs).
process.env.TM_SHARD = '2/3';
await import('./test-taskmanager.mjs');
