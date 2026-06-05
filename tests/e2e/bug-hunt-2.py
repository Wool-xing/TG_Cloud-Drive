"""
Bug hunt Phase 2 — share security, upload edges, token attacks, XSS probes.
"""
import requests, json, sys, time, os, io, base64, uuid
from concurrent.futures import ThreadPoolExecutor, as_completed

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = "http://localhost:3000"
BUGS = []

def bug(sev, area, title, detail="", actual=""):
    BUGS.append({"severity": sev, "area": area, "title": title, "detail": detail, "actual": str(actual)[:200]})
    ic = {"CRIT":"🔥","HIGH":"🟠","MED":"🟡","LOW":"🔵"}
    print(f"  {ic.get(sev,'?')} [{sev}] {title}")
    if detail: print(f"     {detail}")

def api(method, path, data=None, token=None):
    h = {"Content-Type": "application/json"} if data is not None else {}
    if token: h["Authorization"] = f"Bearer {token}"
    try:
        r = requests.request(method, f"{BASE}{path}", json=data, headers=h, timeout=10)
        try: body = r.json()
        except: body = {"_raw": r.text[:500]}
        return r.status_code, body, r.headers
    except Exception as e:
        return None, str(e), {}

def api_upload(path, fields, filename="test.bin", content=b"data", token=None):
    """Upload with multipart — for /api/files/upload-chunk"""
    h = {}
    if token: h["Authorization"] = f"Bearer {token}"
    try:
        r = requests.post(f"{BASE}{path}", data=fields, files={"chunk": (filename, content)}, headers=h, timeout=10)
        try: body = r.json()
        except: body = {"_raw": r.text[:500]}
        return r.status_code, body, r.headers
    except Exception as e:
        return None, str(e), {}

# Setup
print("Setup...")
r = requests.post(f"{BASE}/api/auth/login", json={"identifier": "admin", "password": "Wool"}, timeout=10)
if r.status_code == 429: time.sleep(60); r = requests.post(f"{BASE}/api/auth/login", json={"identifier": "admin", "password": "Wool"}, timeout=10)
TOKEN = r.json().get("data", {}).get("accessToken", "")
if not TOKEN: print("FAILED login"); sys.exit(1)
print(f"Admin OK")

# Create test file
r = api("POST", "/api/files/document", {"name": f"hunt2_{int(time.time())}.txt", "parentId": None, "mimeType": "text/plain", "content": "target"}, TOKEN)
DOC_ID = r[1].get("data", {}).get("id", "")

# ── 7. SHARE SECURITY ──────────────────────────────────────────────────
print("\n📦 SHARE ATTACKS")

# 7a. Share password edge cases
for pw, label in [
    ("", "empty"),
    ("a" * 200, "200-char"),
    ("<script>alert(1)</script>", "XSS"),
    ("' OR '1'='1", "SQL injection"),
]:
    r = api("POST", "/api/shares", {"nodeId": DOC_ID, "password": pw}, TOKEN)
    if r[0] == 500: bug("MED", "Share", f"Password '{label}' causes 500", f"HTTP {r[0]}")

# 7b. Share expiry edge cases
for exp, label in [("2020-01-01", "past"), ("2099-12-31", "far-future"), ("not-a-date", "invalid")]:
    r = api("POST", "/api/shares", {"nodeId": DOC_ID, "expiresAt": exp}, TOKEN)
    if r[0] == 500: bug("HIGH", "Share", f"Expiry '{label}' causes 500", f"HTTP {r[0]}")

# 7c. Share download limit
for limit, label in [(-1, "negative"), (0, "zero"), (999999, "huge"), ("abc", "string")]:
    r = api("POST", "/api/shares", {"nodeId": DOC_ID, "downloadLimit": limit}, TOKEN)
    if r[0] == 500: bug("MED", "Share", f"downloadLimit={label} causes 500", f"HTTP {r[0]}")

# 7d. Access deleted share
r = api("POST", "/api/shares", {"nodeId": DOC_ID}, TOKEN)
stok = r[1].get("data", {}).get("token", ""); sid = r[1].get("data", {}).get("id", "")
if sid:
    api("DELETE", f"/api/shares/{sid}", token=TOKEN)
    r = api("GET", f"/api/shares/access/{stok}")
    if r[0] == 200: bug("HIGH", "Share", "Deleted share still accessible", f"HTTP {r[0]}")
    elif r[0] in (404, 410): pass
    elif r[0] == 500: bug("MED", "Share", "Access deleted share → 500", f"HTTP {r[0]}")

# 7e. One-time share accessed twice
r = api("POST", "/api/shares", {"nodeId": DOC_ID, "oneTime": True}, TOKEN)
ot_tok = r[1].get("data", {}).get("token", "")
if ot_tok:
    r1 = api("GET", f"/api/shares/access/{ot_tok}")
    r2 = api("GET", f"/api/shares/access/{ot_tok}")
    if r1[0] == 200 and r2[0] == 200:
        bug("HIGH", "Share", "One-time share accessible TWICE!", f"1st={r1[0]} 2nd={r2[0]}")

# ── 8. TOKEN ATTACKS ──────────────────────────────────────────────────
print("\n🎫 TOKEN ATTACKS")

# 8a. Fake expired JWT (Base64: {"sub":"test","exp":1})
FAKE_JWT = "x.y.z"
r = api("GET", "/api/files", token=FAKE_JWT)
if r[0] in (401, 403): pass
elif r[0] == 500: bug("HIGH", "Token", "Fake JWT causes 500", f"HTTP {r[0]}")

# 8b. Empty token
r = api("GET", "/api/files", token="")
if r[0] in (401, 403): pass
elif r[0] == 500: bug("MED", "Token", "Empty token causes 500", f"HTTP {r[0]}")

# 8c. Token without Bearer prefix (raw token)
r = requests.get(f"{BASE}/api/files", headers={"Authorization": TOKEN}, timeout=5)
if r.status_code == 200: bug("MED", "Token", "Token without 'Bearer' prefix accepted", f"HTTP {r.status_code}")

# 8d. Null byte in token
r = api("GET", "/api/files", token="Bearer \x00test")
if r[0] == 500: bug("HIGH", "Token", "Null byte in token causes 500", f"HTTP {r[0]}")

# ── 9. UPLOAD EDGE CASES ──────────────────────────────────────────────
print("\n📤 UPLOAD ATTACKS")

def up_fields(key, idx, total, fname="test.txt", md5="abc", mime="text/plain", parent=None, private="false", edek="x", div="x", civ="x", salt="x"):
    return {"idempotencyKey": key, "chunkIndex": str(idx), "totalChunks": str(total),
            "filename": fname, "md5": md5, "mimeType": mime,
            "parentId": parent or "null", "private": private,
            "encryptedDek": edek, "dekIv": div, "chunkIv": civ, "salt": salt}

# 9a. Skip chunk 0 — send chunkIndex=1 when totalChunks=2 without chunk 0
key = f"skip0_{int(time.time())}"
r = api_upload("/api/files/upload-chunk", up_fields(key, 1, 2), token=TOKEN)
if r[0] == 500: bug("MED", "Upload", "chunkIndex=1 without chunk 0 → 500", f"HTTP {r[0]}")
elif r[0] in (400, 409): pass
elif r[0] in (200, 201): pass  # might create partial

# 9b. Negative chunk index
key2 = f"neg_{int(time.time())}"
r = api_upload("/api/files/upload-chunk", up_fields(key2, -1, 2), token=TOKEN)
if r[0] == 500: bug("MED", "Upload", "Negative chunk index → 500", f"HTTP {r[0]}")
elif r[0] in (400, 409): pass

# 9c. chunkIndex >= totalChunks
key3 = f"overflow_{int(time.time())}"
api_upload("/api/files/upload-chunk", up_fields(key3, 0, 1), token=TOKEN)
r = api_upload("/api/files/upload-chunk", up_fields(key3, 1, 1), token=TOKEN)
if r[0] == 500: bug("MED", "Upload", "chunkIndex >= totalChunks → 500", f"HTTP {r[0]}")
elif r[0] in (400, 409): pass
elif r[0] in (200, 201): bug("LOW", "Upload", "Oversized chunkIndex accepted silently", f"HTTP {r[0]}")

# 9d. Idempotency key reuse — different params
key4 = f"reuse_{int(time.time())}"
r1 = api_upload("/api/files/upload-chunk", up_fields(key4, 0, 1, fname="first.txt", md5="md5_1"), token=TOKEN)
r2 = api_upload("/api/files/upload-chunk", up_fields(key4, 0, 1, fname="second.txt", md5="md5_2"), token=TOKEN)
if r2[0] == 500: bug("HIGH", "Upload", "Idempotency key reuse with different file params → 500", f"HTTP {r2[0]}")
elif r2[0] in (200, 201, 409): pass

# 9e. Non-numeric chunkIndex
key5 = f"nan_{int(time.time())}"
r = api_upload("/api/files/upload-chunk", up_fields(key5, "abc", 2), token=TOKEN)
if r[0] == 500: bug("MED", "Upload", "Non-numeric chunkIndex → 500", f"HTTP {r[0]}")
elif r[0] in (400, 409): pass

# ── 10. WEBDAV ─────────────────────────────────────────────────────────
print("\n🗂️ WEBDAV")

# 10a. Path traversal via WebDAV
r = requests.request("GET", f"{BASE}/api/dav/../../../etc/passwd", timeout=5)
if r.status_code == 200 and "root:" in r.text:
    bug("CRIT", "WebDAV", "PATH TRAVERSAL: /etc/passwd accessible!")

# 10b. Various WebDAV methods
for method in ["LOCK", "UNLOCK", "MKCOL", "MOVE", "COPY", "PROPPATCH"]:
    r = requests.request(method, f"{BASE}/api/dav/test", timeout=5)
    if r.status_code == 500: bug("MED", "WebDAV", f"{method} causes 500", f"HTTP {r.status_code}")

# ── 11. PRIVATE SPACE ──────────────────────────────────────────────────
print("\n🔐 PRIVATE SPACE")

# 11a. Multiple failed verify attemps
for i in range(3):
    r = api("POST", "/api/users/private-space/verify", {"password": f"wrong_{i}"}, TOKEN)
    if r[0] == 500: bug("MED", "PrivateSpace", f"Verify attempt #{i} → 500", f"HTTP {r[0]}")

# ── 12. XSS PROBES ────────────────────────────────────────────────────
print("\n🖥️ XSS PROBES")

if DOC_ID:
    for payload, label in [
        ("<img src=x onerror=alert(1)>", "img-onerror"),
        ("<svg onload=alert(1)>", "svg-onload"),
        ("<script>alert(1)</script>", "script tag"),
    ]:
        r = api("PUT", f"/api/files/{DOC_ID}/note", {"note": payload}, TOKEN)
        if r[0] == 500: bug("MED", "XSS", f"XSS in note ({label}) → 500", f"HTTP {r[0]}")
        # If accepted (200/201), frontend must escape on render — not a backend bug

# ─── SUMMARY ─────────────────────────────────────────────────────────────
print(f"\n{'='*60}")
if not BUGS:
    print("🎉 NO BUGS FOUND in Phase 2!")
else:
    by_sev = {}
    for b in BUGS: by_sev.setdefault(b["severity"], []).append(b)
    print(f"🐛 {len(BUGS)} BUGS: {len(by_sev.get('CRIT',[]))} CRIT, {len(by_sev.get('HIGH',[]))} HIGH, {len(by_sev.get('MED',[]))} MED\n")
    for b in BUGS:
        print(f"  {b['severity']:5s} [{b['area']:15s}] {b['title']}")

sys.exit(1 if BUGS else 0)
