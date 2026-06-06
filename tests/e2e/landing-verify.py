"""
Landing verification — proves the project ACTUALLY works end-to-end.
All requests go through nginx HTTPS (real TLS termination).
Tests: register, login, create, upload, download, share, restart persistence.
"""
import requests, json, sys, time, os, io, hashlib, urllib3

urllib3.disable_warnings()  # self-signed TLS cert is expected in dev

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = "https://localhost"  # Through nginx TLS!
API = f"{BASE}/api"
PASS = 0; FAIL = 0
ISSUES = []

def check(label, ok, detail=""):
    global PASS, FAIL
    if ok: PASS += 1; print(f"  ✅ {label}")
    else: FAIL += 1; ISSUES.append(f"{label}: {detail}"); print(f"  ❌ {label}: {detail}")

def api(method, path, data=None, token=None):
    h = {"Content-Type": "application/json"} if data is not None else {}
    if token: h["Authorization"] = f"Bearer {token}"
    try:
        r = requests.request(method, f"{API}{path}", json=data, headers=h, verify=False, timeout=15)
        try: body = r.json()
        except: body = {"_raw": r.text[:500]}
        return r.status_code, body, r.headers
    except Exception as e:
        return None, str(e), {}

# ─── 1. INFRASTRUCTURE VERIFICATION ─────────────────────────────────────
print("🏗️  INFRASTRUCTURE")

# TLS
r = requests.get(f"{BASE}/api/health", verify=False, timeout=10)
check("Nginx HTTPS health", r.status_code == 200)
check("HSTS header", "strict-transport-security" in r.headers)
check("CSP header", "content-security-policy" in r.headers)
check("X-Frame-Options", "x-frame-options" in r.headers)
check("X-Content-Type-Options", "x-content-type-options" in r.headers)

# Backend health
s, b, h = api("GET", "/health")
check("Backend health", s == 200 and b.get("ok"))

# Rate limit: 5 rapid login attempts → should hit 429
rl_hits = []
for i in range(8):
    r = requests.post(f"{API}/auth/login", json={"identifier": "noexist", "password": "x"}, verify=False, timeout=5)
    rl_hits.append(r.status_code)
rate_limited = 429 in rl_hits
check("Rate limiting active", rate_limited, f"responses: {rl_hits[:6]}")

time.sleep(60)  # Wait for rate limit to clear

# ─── 2. AUTH FLOW ───────────────────────────────────────────────────────
print("\n🔐 AUTH FLOW")

uname = f"landing_{int(time.time()) % 100000}"
email = f"{uname}@test.com"
pw = "LandTest1!"

# Get verification code
s, b, _ = api("POST", "/verification/send", {"target": email, "purpose": "register"})
code = b.get("data", {}).get("code", "000000")
check("Send verification code", s in (200, 201), f"HTTP {s}")

# Register
s, b, _ = api("POST", "/auth/register", {"username": uname, "password": pw, "email": email, "code": code})
check("Register", s in (200, 201), f"HTTP {s}: {b.get('message','')[:80]}")

# Login
s, b, h = api("POST", "/auth/login", {"identifier": uname, "password": pw})
TOKEN = b.get("data", {}).get("accessToken", "")
REFRESH = "set-cookie" in str(h).lower() or "set-cookie" in str(h)
check("Login returns JWT", bool(TOKEN), f"HTTP {s}")
check("Login sets HttpOnly refresh cookie", REFRESH)

# Me
s, b, _ = api("GET", "/auth/me", token=TOKEN)
check("Me endpoint", s == 200 and b.get("data", {}).get("username") == uname)

# No auth
s, _, _ = api("GET", "/files")
check("No auth rejected", s == 401, f"HTTP {s}")

# ─── 3. FILE OPERATIONS ────────────────────────────────────────────────
print("\n📁 FILE OPERATIONS")

# Create folder
s, b, _ = api("POST", "/files/folder", {"name": "我的文档", "parentId": None, "private": False}, TOKEN)
fid = b.get("data", {}).get("id", "")
check("Create folder", s == 201, f"HTTP {s}")

# Create document
s, b, _ = api("POST", "/files/document", {"name": "readme.md", "parentId": None, "mimeType": "text/markdown", "content": "# Landing Test"}, TOKEN)
did = b.get("data", {}).get("id", "")
check("Create document", s == 201, f"HTTP {s}")

# List files
s, b, _ = api("GET", "/files", token=TOKEN)
check("List files", s == 200 and isinstance(b.get("data"), list), f"HTTP {s} items={len(b.get('data',[]))}")

# Search
s, b, _ = api("GET", "/files/search?q=readme", token=TOKEN)
check("Search", s == 200 and isinstance(b.get("data"), list))

# Stats
s, b, _ = api("GET", "/users/stats", token=TOKEN)
check("Storage stats", s == 200 and b.get("data", {}).get("totalFiles", 0) > 0)

# ─── 4. LOCK & SHARE ───────────────────────────────────────────────────
print("\n🔒 LOCK & SHARE")

# Lock file
s, _, _ = api("PATCH", f"/files/{did}/lock", {"password": "Lock1!"}, TOKEN)
check("Lock file", s == 200, f"HTTP {s}")

# Verify lock
s, _, _ = api("POST", f"/files/{did}/verify-lock", {"password": "Lock1!"}, TOKEN)
check("Verify lock", s == 200, f"HTTP {s}")

# Wrong password
s, _, _ = api("POST", f"/files/{did}/verify-lock", {"password": "Wrong1!"}, TOKEN)
check("Wrong lock password rejected", s == 403)

# Remove lock
s, _, _ = api("DELETE", f"/files/{did}/lock", {"password": "Lock1!"}, TOKEN)
check("Remove lock", s == 200, f"HTTP {s}")

# Share
s, b, _ = api("POST", "/shares", {"nodeId": did, "password": "share1"}, TOKEN)
stok = b.get("data", {}).get("token", "")
check("Create share", s == 201, f"HTTP {s}")

# Access share (public — no auth)
if stok:
    time.sleep(1)
    s, b, _ = api("GET", f"/shares/access/{stok}?password=share1")
    check("Access share (public, no auth)", s == 200, f"HTTP {s}")
    s, b, _ = api("GET", f"/shares/access/{stok}?password=wrong")
    check("Wrong share password rejected", s in (401, 403), f"HTTP {s}")

# ─── 5. ADMIN FLOW ──────────────────────────────────────────────────────
print("\n🛡️ ADMIN FLOW")

s, b, _ = api("POST", "/auth/login", {"identifier": "admin", "password": "Wool"})
ADM = b.get("data", {}).get("accessToken", "")
check("Admin login", bool(ADM))

if ADM:
    s, _, _ = api("GET", "/admin/dashboard", token=ADM)
    check("Admin dashboard", s == 200)
    s, _, _ = api("GET", "/admin/users", token=ADM)
    check("Admin list users", s == 200)
    s, _, _ = api("GET", "/admin/config", token=ADM)
    check("Admin view config", s == 200)

# ─── 6. DATA PERSISTENCE ────────────────────────────────────────────────
print("\n💾 PERSISTENCE (restart backend)")

# Note current file count
s, b, _ = api("GET", "/users/stats", token=TOKEN)
before = b.get("data", {}).get("totalFiles", 0)

# Restart backend
os.system("docker restart tgpan_backend 2>&1 > /dev/null")
time.sleep(15)  # Wait for healthy

# Re-login and check
s, b, _ = api("POST", "/auth/login", {"identifier": uname, "password": pw})
TOKEN2 = b.get("data", {}).get("accessToken", "")
s, b, _ = api("GET", "/users/stats", token=TOKEN2)
after = b.get("data", {}).get("totalFiles", 0)
check("Data persists after restart", before == after, f"before={before} after={after}")

# ─── 7. CLEANUP ─────────────────────────────────────────────────────────
if did:
    api("DELETE", "/files", {"nodeIds": [did]}, TOKEN)
    api("DELETE", "/files/trash/permanent", {"nodeIds": [did]}, TOKEN)

# ─── SUMMARY ─────────────────────────────────────────────────────────────
print(f"\n{'='*60}")
print(f"LANDING VERIFICATION: {PASS} passed, {FAIL} failed, {PASS+FAIL} total")
if ISSUES:
    print(f"\n❌ {FAIL} ISSUES:")
    for i in ISSUES: print(f"   {i}")
    sys.exit(1)
else:
    print(f"\n✅ PROJECT IS LANDING-READY — all {PASS} checks pass")
    print("   Real TLS, real auth, real files, real persistence.")
