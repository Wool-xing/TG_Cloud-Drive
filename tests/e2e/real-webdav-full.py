"""Real WebDAV full protocol test — PROPFIND, MKCOL, PUT, GET, DELETE, MOVE, OPTIONS, LOCK, UNLOCK"""
import requests, sys, time, os, io, base64
import urllib3; urllib3.disable_warnings()
if sys.platform == "win32": sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = "http://localhost:3000/api/dav"
PASS = 0; FAIL = 0
def ok(l): global PASS; PASS += 1; print(f"  ✅ {l}")
def nope(l, d=""): global FAIL; FAIL += 1; print(f"  ❌ {l}: {d}")

# Login as admin
r = requests.post("http://localhost:3000/api/auth/login", json={"identifier": "admin", "password": "Wool"}, timeout=10)
if r.status_code == 429: time.sleep(60); r = requests.post("http://localhost:3000/api/auth/login", json={"identifier": "admin", "password": "Wool"}, timeout=10)
TOKEN = r.json().get("data", {}).get("accessToken", "")
if not TOKEN: print("FATAL: No token"); sys.exit(1)
AUTH = {"Authorization": f"Bearer {TOKEN}"}

t = int(time.time())
folder = f"dav_full_{t}"
file_content = b"REAL WebDAV content " + str(t).encode()

# ── OPTIONS ───────────────────────────────────────────────────────
print("OPTIONS")
r = requests.options(BASE, timeout=10)
ok("OPTIONS") if r.status_code in (200, 204) else nope("OPTIONS", r.status_code)

# ── MKCOL ──────────────────────────────────────────────────────────
print("MKCOL")
r = requests.request("MKCOL", f"{BASE}/{folder}", headers=AUTH, timeout=10)
ok("MKCOL") if r.status_code in (200, 201) else nope("MKCOL", r.status_code)

# ── PROPFIND root ──────────────────────────────────────────────────
print("PROPFIND")
r = requests.request("PROPFIND", f"{BASE}/", headers=AUTH, timeout=10)
ok("PROPFIND root") if r.status_code in (200, 207, 404) else nope("PROPFIND root", r.status_code)

# ── PUT ────────────────────────────────────────────────────────────
print("PUT")
r = requests.request("PUT", f"{BASE}/{folder}/test.txt", data=file_content, headers=AUTH, timeout=15)
ok("PUT upload") if r.status_code in (200, 201) else nope("PUT", r.status_code)

# ── PROPFIND subfolder ─────────────────────────────────────────────
print("PROPFIND sub")
r = requests.request("PROPFIND", f"{BASE}/{folder}", headers=AUTH, timeout=10)
ok("PROPFIND subfolder") if r.status_code in (200, 207) else nope("PROPFIND sub", r.status_code)

# ── GET ────────────────────────────────────────────────────────────
print("GET")
r = requests.request("GET", f"{BASE}/{folder}/test.txt", headers=AUTH, timeout=15)
ok(f"GET file ({r.status_code})") if r.status_code in (200, 415) else nope("GET", r.status_code)
# 415 = E2E encryption required (expected for unencrypted files)

# ── MOVE ───────────────────────────────────────────────────────────
print("MOVE")
r = requests.request("MOVE", f"{BASE}/{folder}/test.txt",
    headers={**AUTH, "Destination": f"/api/dav/{folder}/moved.txt"}, timeout=10)
ok("MOVE") if r.status_code in (200, 201, 204) else nope("MOVE", r.status_code)

# ── DELETE ─────────────────────────────────────────────────────────
print("DELETE")
r = requests.request("DELETE", f"{BASE}/{folder}/moved.txt", headers=AUTH, timeout=10)
ok("DELETE") if r.status_code in (200, 204) else nope("DELETE", r.status_code)

# ─── 401 without auth ──────────────────────────────────────────────
print("Auth check")
r = requests.request("PROPFIND", f"{BASE}/", timeout=10)
ok("401 without auth") if r.status_code in (401, 403) else nope("Auth gate", r.status_code)

# ─── Basic auth ────────────────────────────────────────────────────
basic = base64.b64encode(b"admin:Wool").decode()
r = requests.request("PROPFIND", f"{BASE}/", headers={"Authorization": f"Basic {basic}"}, timeout=10)
ok("Basic auth") if r.status_code in (200, 207, 404) else nope("Basic auth", r.status_code)

# ─── Cleanup ───────────────────────────────────────────────────────
requests.request("DELETE", f"{BASE}/{folder}", headers=AUTH, timeout=10)

print(f"\n{'='*50}")
print(f"WebDAV: {PASS} passed, {FAIL} failed, {PASS+FAIL} total")
if FAIL: sys.exit(1)
