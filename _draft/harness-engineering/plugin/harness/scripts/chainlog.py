#!/usr/bin/env python3
"""
chainlog.py — Shared tamper-evident hash-chain primitives for append-only cycle records.

hypotheses.jsonl (가설) 와 bar.jsonl (품질 바) 가 같은 체인 모델을 쓴다.
한 곳에서 검증된 구현을 둘이 공유 — 보안 임계 로직의 drift 방지 (DRY).
해시는 (prev_hash + 'hash' 제외 정렬 JSON) 의 SHA-256. 기존 hypotheses.jsonl 과 동일 계산식.
"""
import hashlib
import json
from pathlib import Path

GENESIS = "0" * 64


def compute_hash(entry: dict, prev_hash: str) -> str:
    payload = json.dumps(
        {k: v for k, v in entry.items() if k != "hash"},
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256((prev_hash + payload).encode("utf-8")).hexdigest()


def last_hash(path: Path) -> str:
    if not path.exists():
        return GENESIS
    last = None
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            last = json.loads(line)
    if last is None:
        return GENESIS
    h = last.get("hash")
    if not h:
        raise ValueError(f"last entry in {path} is missing 'hash' field — cannot safely chain")
    return h


def append_entry(path: Path, entry: dict) -> dict:
    """entry(dict)에 prev_hash·hash를 채워 append하고, 기록된 entry를 반환."""
    prev = last_hash(path)
    entry = dict(entry)
    entry["prev_hash"] = prev
    entry["hash"] = compute_hash(entry, prev)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return entry


def verify_chain(path: Path):
    """체인 무결성 검증. 반환 (ok: bool, count: int, error: str|None).

    - 파일이 없으면 (False, 0, "file not found...") 반환.
    - 파일이 존재하지만 항목이 0개면 (True, 0, None) 반환 — 체인이 없으므로 위반도 없음.
    """
    if not path.exists():
        return False, 0, f"file not found: {path}"
    prev = GENESIS
    count = 0
    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError as e:
            return False, count, f"line {i}: malformed JSON ({e})"
        if entry.get("prev_hash") != prev:
            return False, count, (
                f"line {i} [{entry.get('id')}]: prev_hash mismatch — chain broken"
            )
        expected = compute_hash(entry, prev)
        if entry.get("hash") != expected:
            return False, count, (
                f"line {i} [{entry.get('id')}]: hash mismatch — TAMPERED"
            )
        prev = entry["hash"]
        count += 1
    return True, count, None
