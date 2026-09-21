# S1 — put an event, list it, stale If-Match is refused
Actor: alice · Auth: basic (app password: alice / app-alice)   Namespace: s1-<run id>
Server: `python3 dav.py <port>` — CalDAV-ish, see dav.py docstring. uid = s1-<run id>

| Step | Request | Capture | Assert |
|------|---------|---------|--------|
| 1 | PUT /calendars/alice/default/{uid}.ics · body: text/calendar (BEGIN:VCALENDAR / BEGIN:VEVENT / UID:{uid} / SUMMARY:s1 / END:VEVENT / END:VCALENDAR) | header ETag → etag | 201, ETag present |
| 2 | PROPFIND /calendars/alice/default/ · Depth: 1 · body: application/xml `<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>` | xml //d:response[d:href contains {uid}]/d:propstat/d:prop/d:getetag → listed_etag | 207, listed_etag = etag, d:status contains "200" |
| 3 | PUT /calendars/alice/default/{uid}.ics · If-Match: "stale" · body: text/calendar (same, SUMMARY:changed) | — | [확인 필요: docs say 412 — send it, record code] |
| 4 | GET /calendars/alice/default/{uid}.ics | header ETag → etag2 | 200, etag2 = etag, body contains "SUMMARY:s1" (step 3 changed nothing) |
| 5 | PUT /calendars/alice/default/{uid}.ics · If-Match: {etag} · body: text/calendar (SUMMARY:changed) | header ETag → etag3 | 200, etag3 ≠ etag |
| 6 | GET /calendars/bob/default/{uid}.ics | — | [확인 필요: other user's calendar — send it, record code] |
Cleanup: DELETE /calendars/alice/default/{uid}.ics
