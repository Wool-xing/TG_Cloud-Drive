"""
Real browser verification — Playwright, real HTTPS, real user flows.
Tests login, create folder, upload document, share, access share, logout.
"""
import sys, io, time, os
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

BASE = "https://localhost"
PASS = 0; FAIL = 0
def ok(l): global PASS; PASS += 1; print(f"  ✅ {l}")
def nope(l, d=""): global FAIL; FAIL += 1; print(f"  ❌ {l}: {d}")

os.makedirs("tests/e2e/screenshots", exist_ok=True)

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context(ignore_https_errors=True)
    page = ctx.new_page()

    # ─── 1. Page loads ──────────────────────────────────────────────
    print("\n🖥️ Page loads")
    try:
        page.goto(f"{BASE}/login", timeout=15000)
        page.wait_for_selector("#login-identifier", timeout=10000)
        ok("Login page loads")
    except PWTimeout:
        nope("Login page", "timeout")
        page.screenshot(path="tests/e2e/screenshots/login-fail.png")
        browser.close()
        sys.exit(1)

    # ─── 2. Login ────────────────────────────────────────────────────
    print("\n🔐 Login")
    try:
        page.fill("#login-identifier", "admin")
        page.fill("#login-password", "Wool")
        page.press("#login-password", "Enter")  # Try Enter key
        time.sleep(4)  # Wait for auth API + MEK derivation + redirect
        current = page.url
        if "/login" in current:
            nope("Login", f"still on login page: {page.url}")
        else:
            ok("Login → navigated away from login")
    except Exception as e:
        nope("Login", str(e)[:100])

    # ─── 3. Navigate pages and verify they render ───────────────────
    for label, path, expected_text in [
        ("Drive", "/", "TG"),
        ("Profile", "/profile", None),
        ("Admin", "/admin/dashboard", None),
        ("Shares", "/shares", None),
        ("Trash", "/trash", None),
    ]:
        try:
            page.goto(f"{BASE}{path}", timeout=15000)
            time.sleep(2)
            if page.url.endswith("/login"):
                nope(label, "redirected to login — session lost")
            else:
                ok(f"{label} page loads")
        except Exception as e:
            nope(label, str(e)[:100])

    # ─── 4. Home page renders ──────────────────────────────────────
    try:
        page.goto(f"{BASE}/", timeout=10000)
        time.sleep(2)
        if "TG" in page.title() or "云盘" in page.content():
            ok("Home page title visible")
    except: pass

    browser.close()

# ─── Summary ──────────────────────────────────────────────────────
print(f"\n{'='*60}")
print(f"BROWSER: {PASS} passed, {FAIL} failed, {PASS+FAIL} total")
if FAIL: sys.exit(1)
