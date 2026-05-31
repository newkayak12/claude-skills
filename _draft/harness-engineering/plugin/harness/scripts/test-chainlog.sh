#!/usr/bin/env bash
# chainlog 단위 self-test — append 후 verify OK, 변조 후 verify FAIL.
set -u
cd "$(dirname "$0")" || exit 1
TMP=$(mktemp -d)
python3 - "$TMP/x.jsonl" <<'PY'
import sys; from pathlib import Path
sys.path.insert(0, ".")
import chainlog as c
p = Path(sys.argv[1])
c.append_entry(p, {"id":"A","v":1})
c.append_entry(p, {"id":"B","v":2})
ok, n, err = c.verify_chain(p)
assert ok and n == 2, (ok, n, err)
lines = p.read_text().splitlines()
import json
e = json.loads(lines[1]); e["v"] = 999
lines[1] = json.dumps(e, ensure_ascii=False)
p.write_text("\n".join(lines) + "\n")
ok2, _, err2 = c.verify_chain(p)
assert not ok2 and "TAMPERED" in (err2 or ""), (ok2, err2)
# 시나리오 2: prev_hash 링크를 끊되 hash는 재계산 → "chain broken" 분기
p.unlink(); c.append_entry(p, {"id":"A","v":1}); c.append_entry(p, {"id":"B","v":2})
lines = p.read_text().splitlines()
e = json.loads(lines[1])
e["prev_hash"] = "0" * 64           # 잘못된 prev
e["hash"] = c.compute_hash(e, "0" * 64)
lines[1] = json.dumps(e, ensure_ascii=False)
p.write_text("\n".join(lines) + "\n")
ok3, _, err3 = c.verify_chain(p)
assert not ok3 and "chain broken" in (err3 or ""), (ok3, err3)
print("chainlog self-test: PASS")
PY
rc=$?
rm -rf "$TMP"
exit $rc
