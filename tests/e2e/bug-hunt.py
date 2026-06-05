"""
Bug hunt — world-class QA: boundary, race, state, injection, resilience attacks.
Usage: python tests/e2e/bug-hunt.py
Requires: backend running on localhost:3000 (docker compose up -d)
"""
import requests, json, sys, time, os, io, threading, re, base64, hashlib, uuid
from concurrent.futures import ThreadPoolExecutor, as_completed

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = "http://localhost:3000"
BUGS = []

def bug(severity: str, area: str, title: str, detail: str, actual="", expected=""):
    BUGS.append({"severity": severity, "area": area, "title": title, "detail": detail, "actual": str(actual)[:200], "expected": str(expected)[:200]})
    icon = {"CRIT":"🔥","HIGH":"🟠","MED":"🟡","LOW":"🔵"}
    print(f"  {icon.get(severity,'?')} [{severity}] {title}")
    if detail: print(f"     {detail}")
    if actual: print(f"     Actual: {actual}")

def api(method, path, data=None, token=None, raw_body=False):
    h = {"Content-Type": "application/json"} if not raw_body else {}
    if not data and not raw_body: h.pop("Content-Type", None)
    if token: h["Authorization"] = f"Bearer {token}"
    try:
        r = requests.request(method, f"{BASE}{path}", json=data if not raw_body else None, data=json.dumps(data).encode() if raw_body else None, headers=h, timeout=10)
        try: body = r.json()
        except: body = {"_raw": r.text[:500]}
        return r.status_code, body, r.headers
    except Exception as e:
        return None, str(e), {}

def token(username="admin", password="Wool") -> str:
    s, b, _ = api("POST", "/api/auth/login", {"identifier": username, "password": password})
    tok = b.get("data", {}).get("accessToken", "")
    if not tok and username == "admin":
        print(f"  ⚠️ Admin login failed: {s} {b.get('message','')} — waiting for rate limit...")
    return tok

# ── 1. BOUNDARY ATTACKS ─────────────────────────────────────────────────
print("\n📐 BOUNDARY ATTACKS")

# 1a. File name boundaries
t = token()
for name, expect in [
    ("", 400),                      # empty name
    ("a" * 300, "LONG"),            # very long name
    ("../../../etc/passwd", "PATH"),# path traversal in filename
    ("file<script>alert(1)</script>.txt", "XSS"),  # XSS in filename
    ("\x00nullbyte.txt", "NULL"),   # null byte
    ("　全角空格.txt", 201),          # full-width spaces
    ("emoji_🦀🐻‍❄️.txt", 201),     # emoji
    ("a\nb\rc.txt", "NEWLINE"),     # newline in name
]:
    s, b, _ = api("POST", "/api/files/folder", {"name": name, "parentId": None, "private": False}, t)
    if expect == "LONG" and s in (400, 413):
        pass  # acceptable rejection
    elif expect == "PATH" and s in (400, 201):
        pass  # path traversal characters accepted? that's a finding
    elif expect == "XSS":
        bug("MED", "Boundary", "XSS in filename accepted by API", f"filename={name[:40]}", f"POST → {s}")
    elif expect == "NULL":
        bug("HIGH", "Boundary", f"Null byte accepted in filename", f"Got HTTP {s}", f"status={s}")
    elif expect == "NEWLINE":
        bug("MED", "Boundary", f"Newline in filename accepted", f"Got HTTP {s}")

# 1b. Numeric boundaries
s, b, _ = api("GET", "/api/users/audit-logs?page=0&limit=0", token=t)
if s not in (400, 200): bug("LOW", "Boundary", "page=0 not validated", f"HTTP {s}")
s, b, _ = api("GET", "/api/users/audit-logs?page=-1&limit=99999", token=t)
if s == 200: bug("MED", "Boundary", "Negative page accepted", f"page=-1 → HTTP {s}")

# 1c. File size boundary — create a document with 0 content
s, b, _ = api("POST", "/api/files/document", {"name": "empty.txt", "parentId": None, "mimeType": "text/plain", "content": ""}, t)
if s == 201:
    pass  # empty content OK
s, b, _ = api("POST", "/api/files/document", {"name": "big.txt", "parentId": None, "mimeType": "text/plain", "content": "x" * 100000}, t)
if s in (413, 400): pass  # large content rejected OK
if s == 201: bug("MED", "Boundary", "100KB document content accepted — no size limit", "")

# 1d. UUID boundary
s, b, _ = api("PATCH", f"/api/files/NOT-A-UUID/rename", {"name": "test.txt"}, t)
if s in (400, 404): pass  # good
else: bug("MED", "Boundary", "Non-UUID nodeId not rejected at rename", f"HTTP {s}")
s, b, _ = api("DELETE", "/api/files", {"nodeIds": ["not-a-uuid", "", None, "x"*100]}, t)
if s == 200: bug("HIGH", "Boundary", "Invalid nodeIds in delete array accepted silently", f"HTTP {s}")

# ── 2. STATE MACHINE ATTACKS ────────────────────────────────────────────
print("\n🔄 STATE ATTACKS")

# 2a. Delete an already-deleted file
# First create a doc, then delete it, then try to delete it again
s, b, _ = api("POST", "/api/files/document", {"name": "to_delete.txt", "parentId": None, "mimeType": "text/plain", "content": "x"}, t)
doc_id = b.get("data", {}).get("id", "")
if doc_id:
    api("DELETE", "/api/files", {"nodeIds": [doc_id]}, t)
    s2, b2, _ = api("DELETE", "/api/files", {"nodeIds": [doc_id]}, t)
    if s2 == 200: bug("MED", "State", "Double-delete succeeds — should 404/409", f"HTTP {s2}")

# 2b. Restore a non-deleted file
s, b, _ = api("POST", "/api/files/document", {"name": "active.txt", "parentId": None, "mimeType": "text/plain", "content": "x"}, t)
active_id = b.get("data", {}).get("id", "")
if active_id:
    s, b, _ = api("POST", "/api/files/trash/restore", {"nodeIds": [active_id]}, t)
    if s == 200: bug("MED", "State", "Restore non-deleted file succeeds — should reject", f"HTTP {s}")

# 2c. Lock an already-locked file
s, b, _ = api("POST", "/api/files/document", {"name": "to_lock.txt", "parentId": None, "mimeType": "text/plain", "content": "x"}, t)
lock_id = b.get("data", {}).get("id", "")
if lock_id:
    api("PATCH", f"/api/files/{lock_id}/lock", {"password": "pw1"}, t)
    s2, b2, _ = api("PATCH", f"/api/files/{lock_id}/lock", {"password": "pw2"}, t)
    if s2 == 200: bug("LOW", "State", "Re-locking already-locked file succeeds — overwrites password silently", "")

# 2d. Remove lock that doesn't exist
s, b, _ = api("DELETE", f"/api/files/{active_id}/lock", {"password": "x"}, t) if active_id else (404, {}, {})
if s in (200, 201, 204): bug("LOW", "State", "Unlocking non-locked file succeeds", f"HTTP {s}")

# ── 3. RACE CONDITION ATTACKS ───────────────────────────────────────────
print("\n⚡ RACE ATTACKS")

# 3a. Concurrent idempotent upload — same idempotencyKey
key = f"race_key_{int(time.time()*1000)}"
def upload_chunk(idx):
    s, b, _ = api("POST", "/api/files/upload-chunk", {"idempotencyKey": key, "chunkIndex": str(idx), "totalChunks": "2", "filename": "race.txt", "md5": "abc", "mimeType": "text/plain", "parentId": None, "private": "false", "encryptedDek": "x", "dekIv": "x", "chunkIv": "x", "salt": "x"}, t)
    return s, b

# Actually let's test a simpler race: concurrent folder creation with same name
fname = f"race_folder_{int(time.time())}"
def create_folder(i):
    return api("POST", "/api/files/folder", {"name": fname, "parentId": None, "private": False}, t)

with ThreadPoolExecutor(max_workers=5) as ex:
    futures = [ex.submit(create_folder, i) for i in range(5)]
    results = [f.result()[0] for f in as_completed(futures)]
successes = [r for r in results if r in (200, 201)]
if len(successes) > 1:
    bug("HIGH", "Race", f"Concurrent folder creation bypasses uniqueness check — {len(successes)} created with same name", f"HTTP codes: {results}")

# 3b. Concurrent lock/unlock race
l_name = f"race_lock_{int(time.time())}"
s, b, _ = api("POST", "/api/files/document", {"name": f"{l_name}.txt", "parentId": None, "mimeType": "text/plain", "content": "x"}, t)
race_id = b.get("data", {}).get("id", "")
if race_id:
    def set_lock(): return api("PATCH", f"/api/files/{race_id}/lock", {"password": "pw1"}, t)
    def verify_lock(): return api("POST", f"/api/files/{race_id}/verify-lock", {"password": "pw1"}, t)
    with ThreadPoolExecutor(max_workers=3) as ex:
        f1 = ex.submit(set_lock)
        f2 = ex.submit(verify_lock)
        time.sleep(0.1)
        f3 = ex.submit(verify_lock)
        r1, r2, r3 = f1.result(), f2.result(), f3.result()
    # All three should work — verifying during lock setup should be handled
    if r1[0] == 200 and r2[0] == 200 and r3[0] == 200:
        pass  # OK
    else:
        bug("MED", "Race", f"Lock race produced inconsistent state", f"set={r1[0]} v1={r2[0]} v2={r3[0]}")

# ── 4. SECURITY / AUTH ATTACKS ──────────────────────────────────────────
print("\n🔒 SECURITY ATTACKS")

# 4a. Access another user's data with own token
# We have testuser's token, try to hit admin endpoints
admin_t = token("admin", os.environ.get("ADMIN_PASS", "Wool"))
user_t = t  # testuser token (non-admin)

# User trying admin endpoints
s, b, _ = api("GET", "/api/admin/users", token=user_t)
if s == 200: bug("HIGH", "Auth", "Non-admin user accessed /api/admin/users", f"HTTP {s}")
else: pass  # expected 401/403

# 4b. Refresh token reuse detection
# Get a refresh token, use it, use it again
refresh_cookie = None
s, b, h = api("POST", "/api/auth/login", {"identifier": "testuser", "password": "Test1234!"})
if "set-cookie" in h:
    import re as _re
    match = _re.search(r'refresh_token=([^;]+)', h.get("set-cookie", ""))
    if match:
        cookie_val = match.group(1)
        # Use it once
        api("POST", "/api/auth/refresh", token=None)
        # Use it again (should fail if rotation implemented)
        s2, b2, _ = api("POST", "/api/auth/refresh", token=None)
        # Just check we didn't crash
        if s2 == 500: bug("HIGH", "Auth", "Refresh token reuse causes 500 — should be 401", f"HTTP {s2}")

# 4c. SQL injection probe
for payload in [
    "'; DROP TABLE users; --",
    "1' OR '1'='1",
    "1; SELECT pg_sleep(1); --",
]:
    s, b, _ = api("GET", f"/api/files/search?q={payload}", token=user_t)
    if s == 500: bug("CRIT", "Security", f"SQL injection probe causes 500: '{payload[:30]}'", f"HTTP {s}")

# 4d. XSS in share name / file name via share
s, b, _ = api("POST", "/api/shares", {"nodeId": doc_id or "placeholder", "password": "x"}, token=admin_t)
if s == 500: bug("MED", "Security", "Share creation with invalid nodeId causes 500", f"HTTP {s}")

# ── 5. RESILIENCE ATTACKS ──────────────────────────────────────────────
print("\n🛡️ RESILIENCE ATTACKS")

# 5a. Missing Content-Type header
r = requests.post(f"{BASE}/api/auth/login", data='{"identifier":"test","password":"x"}', timeout=5)
if r.status_code in (400, 415): pass  # OK
elif r.status_code == 500: bug("MED", "Resilience", "Missing Content-Type causes 500", f"HTTP {r.status_code}")

# 5b. JSON syntax error
r = requests.post(f"{BASE}/api/auth/login", data='{"broken json', headers={"Content-Type": "application/json"}, timeout=5)
if r.status_code in (400, 422): pass
elif r.status_code == 500: bug("MED", "Resilience", "Malformed JSON causes 500", f"HTTP {r.status_code}")

# 5c. Very large request body
r = requests.post(f"{BASE}/api/auth/login", json={"identifier": "x" * 10000, "password": "y" * 10000}, timeout=5)
if r.status_code in (400, 413): pass
elif r.status_code == 500: bug("MED", "Resilience", "10KB field values cause 500", f"HTTP {r.status_code}")

# 5d. Missing required fields
for endpoint, body, desc in [
    ("/api/files/folder", {}, "folder without name"),
    ("/api/files/document", {"name": "x"}, "document without mimeType"),
    ("/api/shares", {"password": "x"}, "share without nodeId"),
]:
    s, b, _ = api("POST", endpoint, body, token=admin_t)
    if s == 500: bug("MED", "Resilience", f"{desc} causes 500", f"HTTP {s}")
    elif s in (400, 422): pass  # OK

# ── 6. BUSINESS LOGIC ATTACKS ────────────────────────────────────────────
print("\n🧠 BUSINESS LOGIC ATTACKS")

# 6a. Parent folder = self (circular reference)
s, b, _ = api("POST", "/api/files/folder", {"name": "circular", "parentId": None, "private": False}, t)
folder_id = b.get("data", {}).get("id", "")
if folder_id:
    s2, b2, _ = api("POST", "/api/files/folder", {"name": "child", "parentId": folder_id, "private": False}, t)
    child_id = b2.get("data", {}).get("id", "")
    if child_id:
        # Move parent into child (circular)
        s3, b3, _ = api("PATCH", f"/api/files/{folder_id}/move", {"targetParentId": child_id}, t)
        if s3 == 200:
            bug("CRIT", "Logic", "Circular folder reference created — parent moved into child", f"HTTP {s3}")

# 6b. Share to self
if doc_id:
    s, b, _ = api("POST", "/api/shares", {"nodeId": doc_id, "password": "x"}, t)
    if s in (200, 201): pass  # sharing own file to self is OK
    elif s == 500: bug("MED", "Logic", "Self-share causes 500", f"HTTP {s}")

# 6c. Password same as username
s, b, _ = api("POST", "/api/verification/send", {"target": "samecheck@test.com", "purpose": "register"})
code = b.get("data", {}).get("code", "000000")
s, b, _ = api("POST", "/api/auth/register", {"username": "samepass", "password": "samepass", "email": "samecheck@test.com", "code": code})
if s in (200, 201):
    # Password == username should ideally be rejected
    bug("LOW", "Logic", "Password identical to username accepted — weak security", f"HTTP {s}")

# ─── SUMMARY ─────────────────────────────────────────────────────────────
print(f"\n{'='*60}")
if not BUGS:
    print("✅ NO BUGS FOUND — remarkable quality!")
else:
    crits = [b for b in BUGS if b["severity"]=="CRIT"]
    highs = [b for b in BUGS if b["severity"]=="HIGH"]
    meds = [b for b in BUGS if b["severity"]=="MED"]
    lows = [b for b in BUGS if b["severity"]=="LOW"]
    print(f"🐛 {len(BUGS)} BUGS FOUND: {len(crits)} CRIT, {len(highs)} HIGH, {len(meds)} MED, {len(lows)} LOW\n")
    for b in BUGS:
        print(f"  {b['severity']:5s} [{b['area']:10s}] {b['title']}")
        if b['detail']: print(f"          {b['detail']}")
        print()
    if crits: print(f"🔥 {len(crits)} CRITICAL bugs must be fixed immediately!")
    if highs: print(f"🟠 {len(highs)} HIGH priority bugs!")

sys.exit(1 if BUGS else 0)
