"""
Use admin to create user, then real browser interaction.
"""
import requests, sys, io, time, os
if sys.platform == "win32": sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

API = "http://localhost:3000/api"
BASE = "https://localhost"
OUT = "tests/e2e/screenshots"
os.makedirs(OUT, exist_ok=True)

print("🔧 Admin create test user...")
time.sleep(5)  # Brief pause to avoid rate limit
r = requests.post(f"{API}/auth/login", json={"identifier": "admin", "password": "Wool"}, timeout=10)
ATOK = r.json().get("data", {}).get("accessToken", "")
print(f"  Admin login: {'✅' if ATOK else '❌'}")

uname = f"ruser_{int(time.time())%100000}"
pw = "RealUser1!"
# Admin can create user directly (bypasses verification)
r = requests.post(f"{API}/admin/users", json={"username": uname, "password": pw, "role": "user"}, headers={"Authorization": f"Bearer {ATOK}"}, timeout=10)
print(f"  Admin create user {uname}: HTTP {r.status_code}")
if r.status_code not in (200,201):
    print(f"  Error: {r.json().get('message','?')}")

# Login as test user
r = requests.post(f"{API}/auth/login", json={"identifier": uname, "password": pw}, timeout=10)
UTOK = r.json().get("data", {}).get("accessToken", "")
print(f"  User login: {'✅' if UTOK else '❌'}")

if not UTOK:
    print("FATAL: Cannot login as test user")
    sys.exit(1)

# Create real content
r = requests.post(f"{API}/files/folder", json={"name": "My Files", "parentId": None, "private": False}, headers={"Authorization": f"Bearer {UTOK}"}, timeout=10)
fid = r.json().get("data", {}).get("id", "")
print(f"  Create folder: {'✅' if fid else '❌'}")

r = requests.post(f"{API}/files/document", json={"name": "readme.md", "parentId": None, "mimeType": "text/markdown", "content": "# Hello World"}, headers={"Authorization": f"Bearer {UTOK}"}, timeout=10)
did = r.json().get("data", {}).get("id", "")
print(f"  Create document: {'✅' if did else '❌'}")

r = requests.get(f"{API}/files", headers={"Authorization": f"Bearer {UTOK}"}, timeout=10)
files = r.json().get("data", [])
print(f"  Files: {len(files)} items")

r = requests.get(f"{API}/users/stats", headers={"Authorization": f"Bearer {UTOK}"}, timeout=10)
stats = r.json().get("data", {})
print(f"  Storage: {stats.get('usedBytes',0)} bytes, {stats.get('totalFiles',0)} files")

# Share
r = requests.post(f"{API}/shares", json={"nodeId": did, "password": "test"}, headers={"Authorization": f"Bearer {UTOK}"}, timeout=10)
stok = r.json().get("data", {}).get("token", "")
print(f"  Share: {'✅ '+stok[:8] if stok else '❌'}")

# Access share publicly
r = requests.get(f"{API}/shares/access/{stok}?password=test", timeout=10)
print(f"  Public access: HTTP {r.status_code} {'✅' if r.status_code==200 else '❌'}")

# ─── Browser ──────────────────────────────────────────────────────────
print(f"\n🌐 Browser with real user session...")
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context(ignore_https_errors=True)
    page = ctx.new_page()

    page.goto(f"{BASE}/login", timeout=10000)
    page.evaluate(f"""() => {{
        localStorage.setItem('accessToken', '{UTOK}');
    }}""")

    page.goto(f"{BASE}/", timeout=10000)
    time.sleep(2)
    page.screenshot(path=f"{OUT}/real-user-drive.png", full_page=True)
    print("  ✅ Drive screenshot → real-user-drive.png")

    page.goto(f"{BASE}/shares", timeout=10000)
    time.sleep(1)
    page.screenshot(path=f"{OUT}/real-user-shares.png", full_page=True)
    print("  ✅ Shares screenshot → real-user-shares.png")

    browser.close()

print(f"\n✅ REAL: User={uname} Files={len(files)} Storage={stats.get('usedBytes',0)}bytes")
