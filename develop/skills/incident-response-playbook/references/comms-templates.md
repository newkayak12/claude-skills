# Communication Templates

Open in Phase 3. Cadence: update every 15–30 min for P0/P1; communicate before you know the answer.

## Internal Slack Update Template

```
[P0] <Service> - <Brief description>
Status: Investigating / Identified / Mitigating / Resolved
Impact: <Who is affected and how>
Start time: <HH:MM UTC>
Last update: <HH:MM UTC>
IC: @<incident-commander>
Bridge: <link to war room>
Next update: <HH:MM UTC>
```

## Status Page Update Template

```
Investigating: We are aware of an issue affecting <service/feature>.
Our team is actively investigating. We will provide an update by <time>.

Identified: We have identified the cause of the issue affecting <service/feature>.
We are working on a fix and expect resolution by <time>.

Resolved: The issue affecting <service/feature> has been resolved as of <time>.
All systems are operating normally. An RCA will be published within 48-72 hours.
```

**What NOT to say publicly**: internal system names, specific error messages that reveal architecture, speculation about cause before confirmed.
