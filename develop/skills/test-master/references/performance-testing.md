# Performance Tests

Aim: find out how the service behaves under load, against a stated target, before users do.

## Decide the question first

| Test | Question | Shape of load |
|---|---|---|
| Load | Does it meet the target at expected peak? | ramp up, hold at normal peak, ramp down |
| Stress | Where does it break, and how? | keep raising rate past peak |
| Spike | Does it survive and recover from a sudden surge? | jump to a multiple of peak, then drop |
| Soak | Does it leak or degrade over hours? | steady moderate load held for many hours |

## A k6 script

```js
import { sleep, check } from 'k6';
import http from 'k6/http';


export const options = {
  stages: [
    { target: 40, duration: '2m' },   // ramp up
    { target: 40, duration: '8m' },   // hold
    { target: 0, duration: '30s' },   // ramp down
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],    // under 1% errors
    http_req_duration: ['p(95)<350', 'p(99)<900'],
  },
};

export default function () {  // one virtual-user iteration
  const res = http.get(`${__ENV.BASE_URL}/api/orders?size=20`);
  check(res, { 'is ok': (res2) => res2.status === 200 });
  sleep(1);
}
```

If a threshold fails, k6 exits non-zero, so the same script can gate a pipeline.

## Making the numbers mean something

- Express targets as percentiles (p95/p99) plus error rate, taken from an SLO or a business need; averages hide the slow tail.
- Run against an environment shaped like production: same instance size, same data volume, same pool settings. A near-empty database makes every query look fast.
- Generate the load from a separate machine so the generator is not the bottleneck.
- Use realistic request mixes and varied ids; hammering one cached row measures the cache.
- Authenticate once in `setup()` and pass the token, unless login itself is under test.
- Warm up (JIT, pools, caches) before measuring.
- Record the build, config and data size beside each result so runs are comparable.

## Reading the result

While the load runs, watch the server too: CPU, GC pauses, DB connections in use, slow queries, thread pool queue depth. Find the first saturated resource; that is the bottleneck. Change one thing, re-run, compare.
