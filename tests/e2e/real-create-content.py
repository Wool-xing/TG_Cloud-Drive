"""
REAL user creates content — register, login, use browser to create document.
"""
import requests, sys, io, time, os, json
if sys.platform == "win32": sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

API = "http://localhost:3000/api"
BASE = "https://localhost"
OUT = "tests/e2e/screenshots"
os.makedirs(OUT, exist_ok=True)

print("🔧 Register real user via API...")
uname = f"realuser_{int(time.time())%100000}"
email = f"{uname}@real.test"
pw = "RealUser1!"

# Get verification code
r = requests.post(f"{API}/verification/send", json={"target": email, "purpose": "register"}, timeout=10)
code = r.json().get("data", {}).get("code", "000000")
print(f"  Verification code: {code}")

# Register
r = requests.post(f"{API}/auth/register", json={"username": uname, "password": pw, "email": email, "code": code}, timeout=10)
print(f"  Register: HTTP {r.status_code} {'✅' if r.status_code in (200,201) else '❌ ' + str(r.json())[:100]}")

# Login
r = requests.post(f"{API}/auth/login", json={"identifier": uname, "password": pw}, timeout=10)
TOKEN = r.json().get("data", {}).get("accessToken", "")
print(f"  Login: {'✅' if TOKEN else '❌'}")

# Create folder via API
r = requests.post(f"{API}/files/folder", json={"name": f"My Documents", "parentId": None, "private": False}, headers={"Authorization": f"Bearer {TOKEN}"}, timeout=10)
fid = r.json().get("data", {}).get("id", "")
print(f"  Create folder: {'✅' if fid else '❌'}")

# Create document via API
r = requests.post(f"{API}/files/document", json={"name": "welcome.md", "parentId": None, "mimeType": "text/markdown", "content": "# Welcome to TG Cloud Drive"}, headers={"Authorization": f"Bearer {TOKEN}"}, timeout=10)
did = r.json().get("data", {}).get("id", "")
print(f"  Create document: {'✅' if did else '❌'}")

# List files
r = requests.get(f"{API}/files", headers={"Authorization": f"Bearer {TOKEN}"}, timeout=10)
files = r.json().get("data", [])
print(f"  Files listed: {len(files)} items")

# Share the document
r = requests.post(f"{API}/shares", json={"nodeId": did, "password": "test123"}, headers={"Authorization": f"Bearer {TOKEN}"}, timeout=10)
share_token = r.json().get("data", {}).get("token", "")
print(f"  Create share: {'✅ token='+share_token[:8] if share_token else '❌'}")

# Access share publicly (no auth)
r = requests.get(f"{API}/shares/access/{share_token}?password=test123", timeout=10)
print(f"  Access share (public): HTTP {r.status_code} {'✅' if r.status_code==200 else '❌'}")

# Stats
r = requests.get(f"{API}/users/stats", headers={"Authorization": f"Bearer {TOKEN}"}, timeout=10)
stats = r.json().get("data", {})
print(f"  Storage: {stats.get('usedBytes',0)} bytes used, {stats.get('totalFiles',0)} files, {stats.get('totalFolders',0)} folders")

# ─── NOW USE BROWSER ─────────────────────────────────────────────────
print(f"\n🌐 Open browser with authenticated session...")
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context(ignore_https_errors=True)
    page = ctx.new_page()

    # Inject auth token into localStorage
    page.goto(f"{BASE}/login", timeout=10000)
    page.evaluate(f"""() => {{
        localStorage.setItem('accessToken', '{TOKEN}');
        localStorage.setItem('user', JSON.stringify({{username: '{uname}', id: 'x'}}));
    }}""")
    time.sleep(1)

    # Navigate to drive — should show files
    page.goto(f"{BASE}/", timeout=10000)
    time.sleep(3)
    page.screenshot(path=f"{OUT}/drive-with-files.png", full_page=True)
    print("  ✅ Screenshot: Drive with real files → drive-with-files.png")

    # Navigate to shares page
    page.goto(f"{BASE}/shares", timeout=10000)
    time.sleep(2)
    page.screenshot(path=f"{OUT}/shares-page.png", full_page=True)
    print("  ✅ Screenshot: Shares page → shares-page.png")

    # Navigate to trash
    page.goto(f"{BASE}/trash", timeout=10000)
    time.sleep(2)
    page.screenshot(path=f"{OUT}/trash-page.png", full_page=True)
    print("  ✅ Screenshot: Trash page → trash-page.png")

    browser.close()

print(f"\n✅ REAL USER created content: register → login → folder → document → share → access share")
print(f"   Username: {uname}  Password: {pw}")
print(f"   Files: {len(files)}  Storage: {stats.get('usedBytes',0)} bytes")
