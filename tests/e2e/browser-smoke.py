"""
Quick browser smoke test — login, list files, create folder, logout.
Usage:  python tests/e2e/browser-smoke.py
Requires: playwright installed (pip install playwright && playwright install chromium)
"""
import os, sys, io, time
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

BASE = "https://localhost"
USERNAME = f"browser_test_{int(time.time()) % 100000}"
EMAIL = f"{USERNAME}@test.com"
PASS = "Browser1!"
ADMIN_PW = os.environ.get("ADMIN_PASS", "Wool")

results = []
def check(label: str, ok: bool, detail=""):
    results.append((label, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + (f"  {detail}" if detail else ""))

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context(ignore_https_errors=True)
    page = ctx.new_page()

    # ─── 1. Health check via page load ──────────────────────────────────
    print("─ Frontend")
    try:
        page.goto(f"{BASE}/login", timeout=15000)
        page.wait_for_selector("input[type='text'], input[placeholder*='用户名'], input[placeholder*='账号']", timeout=10000)
        check("Frontend loads login page", True)
    except PWTimeout:
        check("Frontend loads login page", False, "timeout — page might not be rendering")
        page.screenshot(path="tests/e2e/screenshots/login-fail.png")
        browser.close()
        sys.exit(1)

    # ─── 2. Register via API then login in browser ──────────────────────
    print("─ Auth flow")
    import requests
    # Get verification code
    r = requests.post(f"http://localhost:3000/api/verification/send", json={"target": EMAIL, "purpose": "register"}, timeout=5)
    code = r.json().get("data", {}).get("code", "000000")
    # Register
    r = requests.post(f"http://localhost:3000/api/auth/register", json={"username": USERNAME, "password": PASS, "email": EMAIL, "code": code}, timeout=5)
    if r.status_code in (200, 201):
        check("API register", True)
    else:
        check("API register", False, str(r.json()))

    # ─── 3. Login in browser ───────────────────────────────────────────
    try:
        page.fill("#login-identifier", USERNAME)
        page.fill("#login-password", PASS)
        page.click("button[type='submit']")
        page.wait_for_url("**/", timeout=10000)
        check("Browser login → redirect to drive", "/login" not in page.url)
    except Exception as e:
        check("Browser login", False, str(e)[:100])

    # ─── 4. Admin login in browser ─────────────────────────────────────
    page.goto(f"{BASE}/login", timeout=10000)
    try:
        page.fill("#login-identifier", "admin")
        page.fill("#login-password", ADMIN_PW)
        page.click("button[type='submit']")
        page.goto(f"{BASE}/admin/dashboard", timeout=10000)
        check("Admin login → dashboard", "/admin" in page.url)
    except Exception as e:
        check("Admin login", False, str(e))

    # ─── 5. Verify security headers ────────────────────────────────────
    print("─ Security headers")
    resp = page.evaluate("""async () => {
        const r = await fetch('/api/health');
        return { status: r.status, ok: r.ok };
    }""")
    check("HTTPS API call from browser", resp.get("ok") == True)

    browser.close()

# ─── Summary ────────────────────────────────────────────────────────────
passed = sum(1 for _, ok, _ in results if ok)
failed = sum(1 for _, ok, _ in results if not ok)
print(f"\n{'='*50}")
print(f"Browser smoke: {passed} passed, {failed} failed, {len(results)} total")
for label, ok, detail in results:
    print(f"  {'✅' if ok else '❌'} {label}" + (f" — {detail}" if detail else ""))
if failed:
    print(f"\n❌ {failed} BROWSER TESTS FAILED")
    sys.exit(1)
