"""Tiny CalDAV-ish server for non-JSON actor evals. stdlib only.
Basic auth: alice / app-alice, bob / app-bob.
PROPFIND /calendars/{user}/default/  (Depth: 1) -> 207 multistatus with d:href + d:getetag per event
PUT /calendars/{user}/default/{uid}.ics  body text/calendar -> 201 + ETag (409 if UID in body != path uid;
    If-Match mismatch -> 412; missing If-Match on existing -> 200 overwrite)
GET  .../{uid}.ics -> 200 text/calendar + ETag | 404
DELETE .../{uid}.ics -> 204 | 404
Other user's calendar -> 403. No auth -> 401.
"""
import base64, hashlib, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

USERS = {"alice": "app-alice", "bob": "app-bob"}
EVENTS = {}  # (user, uid) -> ics text

def etag(t): return '"' + hashlib.sha1(t.encode()).hexdigest()[:12] + '"'

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body=b"", ctype="text/plain", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers()
        if body: self.wfile.write(body if isinstance(body, bytes) else body.encode())
    def _auth(self):
        a = self.headers.get("Authorization", "")
        if not a.startswith("Basic "): return None
        try: u, p = base64.b64decode(a[6:]).decode().split(":", 1)
        except Exception: return None
        return u if USERS.get(u) == p else None
    def _route(self):
        p = self.path.rstrip("/").split("/")
        # /calendars/{user}/default[/{uid}.ics]
        if len(p) >= 4 and p[1] == "calendars" and p[3] == "default":
            return p[2], (p[4][:-4] if len(p) == 5 and p[4].endswith(".ics") else None)
        return None, None
    def _guard(self):
        u = self._auth()
        if not u: self._send(401, "unauthorized", extra={"WWW-Authenticate": 'Basic realm="dav"'}); return None
        owner, uid = self._route()
        if owner is None: self._send(404, "no route"); return None
        if owner != u: self._send(403, "forbidden"); return None
        return u, uid
    def _body(self):
        return self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode()
    def do_PROPFIND(self):
        g = self._guard()
        if not g: return
        u, uid = g
        if self.headers.get("Depth", "0") != "1": return self._send(400, "Depth: 1 required")
        rows = "".join(f'<d:response><d:href>/calendars/{u}/default/{k}.ics</d:href><d:propstat><d:prop><d:getetag>{etag(v).replace(chr(34), "&quot;")}</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>'
                       for (o, k), v in EVENTS.items() if o == u)
        self._send(207, f'<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">{rows}</d:multistatus>', "application/xml")
    def do_PUT(self):
        g = self._guard()
        if not g: return
        u, uid = g
        if not uid: return self._send(405, "PUT needs {uid}.ics")
        body = self._body()
        if f"UID:{uid}" not in body: return self._send(409, "UID in body must match path")
        cur = EVENTS.get((u, uid))
        im = self.headers.get("If-Match")
        if cur is not None and im is not None and im != etag(cur): return self._send(412, "etag mismatch", extra={"ETag": etag(cur)})
        EVENTS[(u, uid)] = body
        self._send(201 if cur is None else 200, "", extra={"ETag": etag(body)})
    def do_GET(self):
        g = self._guard()
        if not g: return
        u, uid = g
        cur = EVENTS.get((u, uid)) if uid else None
        if cur is None: return self._send(404, "not found")
        self._send(200, cur, "text/calendar", extra={"ETag": etag(cur)})
    def do_DELETE(self):
        g = self._guard()
        if not g: return
        u, uid = g
        if uid and (u, uid) in EVENTS: del EVENTS[(u, uid)]; return self._send(204)
        self._send(404, "not found")

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    print(f"dav on :{port}", flush=True)
    HTTPServer(("127.0.0.1", port), H).serve_forever()
