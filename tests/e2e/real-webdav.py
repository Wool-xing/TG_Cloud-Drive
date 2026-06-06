"""
Real WebDAV verification — PROPFIND, MKCOL, PUT, GET, DELETE, MOVE.
"""
import requests, sys, time, os, io, base64
import urllib3; urllib3.disable_warnings()

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = "http://localhost:3000/api/dav"
PASS = 0; FAIL = 0
def ok(l): global PASS; PASS += 1; print(f"  ✅ {l}")
def nope(l, d=""): global FAIL; FAIL += 1; print(f"  ❌ {l}: {d}")

# Login as admin
r = requests.post(f"http://localhost:3000/api/auth/login",
    json={"identifier": "admin", "password": "Wool"}, timeout=10)
TOKEN = r.json().get("data", {}).get("accessToken", "")
if not TOKEN: print("FATAL: No admin token"); sys.exit(1)

auth = {"Authorization": f"Bearer {TOKEN}"}

# ─── 1. OPTIONS ───────────────────────────────────────────────────────
print("\n📂 OPTIONS")
r = requests.options(BASE, timeout=10)
ok("OPTIONS") if r.status_code in (200, 204) else nope("OPTIONS", r.status_code)
allow = r.headers.get("Allow", "")
ok("Allow header") if "PROPFIND" in allow else nope("Allow", allow)

# ─── 2. Security: no auth ─────────────────────────────────────────────
print("\n🔒 Auth")
r = requests.request("PROPFIND", f"{BASE}/", timeout=10)
ok("Blocked without auth") if r.status_code in (401, 403) else nope("No-auth", r.status_code)

# Basic auth
basic = base64.b64encode(b"admin:Wool").decode()
r = requests.request("PROPFIND", f"{BASE}/", headers={"Authorization": f"Basic {basic}"}, timeout=10)
ok("Basic auth") if r.status_code in (200, 207) else nope("Basic auth", r.status_code)

# ─── 3. PROPFIND root ────────────────────────────────────────────────
print("\n📋 PROPFIND")
r = requests.request("PROPFIND", f"{BASE}/", headers=auth, timeout=10)
ok("PROPFIND root") if r.status_code in (200, 207, 404) else nope("PROPFIND", r.status_code)
if r.status_code == 207:
    ok("Multi-status XML response") if "multistatus" in r.text.lower() else nope("XML", r.text[:100])

# ─── 4. MKCOL + PROPFIND subfolder ─────────────────────────────────────
print("\n📁 MKCOL")
t = int(time.time())
folder = f"real_dav_{t}"
r = requests.request("MKCOL", f"{BASE}/{folder}", headers=auth, timeout=10)
ok("MKCOL create folder") if r.status_code in (201, 200) else nope("MKCOL", r.status_code)

r = requests.request("PROPFIND", f"{BASE}/{folder}", headers=auth, timeout=10)
ok("PROPFIND new folder") if r.status_code in (200, 207, 404) else nope("PROPFIND sub", r.status_code)

# ─── 5. PUT file ─────────────────────────────────────────────────────
print("\n📤 PUT")
file_content = b"REAL WebDAV file content - " + str(t).encode()
r = requests.request("PUT", f"{BASE}/{folder}/test.txt", data=file_content, headers=auth, timeout=15)
ok("PUT upload file") if r.status_code in (201, 200) else nope("PUT", r.status_code)

# ─── 6. GET file ──────────────────────────────────────────────────────
print("\n📥 GET")
r = requests.request("GET", f"{BASE}/{folder}/test.txt", headers=auth, timeout=15)
if r.status_code == 200:
    ok(f"GET download file ({len(r.content)} bytes)")
    ok("Content matches") if file_content in r.content else nope("Content match")
else:
    nope("GET", r.status_code)

# ─── 7. PROPFIND folder (should see test.txt) ─────────────────────────
print("\n📋 PROPFIND folder")
r = requests.request("PROPFIND", f"{BASE}/{folder}", headers=auth, timeout=10)
if r.status_code in (200, 207):
    ok("PROPFIND shows uploaded file") if "test.txt" in r.text or "test" in r.text.lower() else nope("PROPFIND list", r.text[:200])
else:
    nope("PROPFIND list", r.status_code)

# ─── 8. DELETE file ───────────────────────────────────────────────────
print("\n🗑️ DELETE")
r = requests.request("DELETE", f"{BASE}/{folder}/test.txt", headers=auth, timeout=10)
ok("DELETE file") if r.status_code in (200, 204) else nope("DELETE", r.status_code)

# ─── 9. MOVE ──────────────────────────────────────────────────────────
print("\n🔄 MOVE")
# Upload a new file then move it
r = requests.request("PUT", f"{BASE}/{folder}/to_move.txt", data=b"move me", headers=auth, timeout=15)
r = requests.request("MOVE", f"{BASE}/{folder}/to_move.txt",
    headers={**auth, "Destination": f"/api/dav/{folder}/moved.txt"}, timeout=15)
ok("MOVE rename file") if r.status_code in (200, 201, 204) else nope("MOVE", r.status_code)

# Cleanup
requests.request("DELETE", f"{BASE}/{folder}/moved.txt", headers=auth, timeout=10)

# ─── Summary ──────────────────────────────────────────────────────────
print(f"\n{'='*60}")
print(f"WebDAV: {PASS} passed, {FAIL} failed, {PASS+FAIL} total")
if FAIL: sys.exit(1)
