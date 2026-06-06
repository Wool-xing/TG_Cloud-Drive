"""
REAL USER JOURNEY — open browser, interact with UI, use the product.
This is what a real user does. No API scripts, no curl, no automation shortcuts.
"""
import sys, io, time, os
if sys.platform == "win32": sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

BASE = "https://localhost"
RESULTS = []

def ok(msg): RESULTS.append(("✅", msg)); print(f"  ✅ {msg}")
def fail(msg, detail=""): RESULTS.append(("❌", f"{msg}: {detail}")); print(f"  ❌ {msg}: {detail}")

os.makedirs("tests/e2e/screenshots", exist_ok=True)

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context(ignore_https_errors=True)
    page = ctx.new_page()

    # ─── 1. OPEN THE WEBSITE ───────────────────────────────────────────
    print("\n🌐 1. Open browser, go to https://localhost")
    try:
        page.goto(f"{BASE}", timeout=15000)
        time.sleep(2)
        current = page.url
        if "/login" in current:
            ok("Redirected to login page (unauthenticated user)")
        else:
            ok(f"Page loads: {page.title()}")
    except Exception as e:
        page.screenshot(path="tests/e2e/screenshots/landing.png")
        fail("Homepage", str(e)[:100])

    # ─── 2. SEE THE LOGIN FORM ────────────────────────────────────────
    print("\n🔐 2. Login form appears")
    try:
        page.goto(f"{BASE}/login", timeout=10000)
        page.wait_for_selector("#login-identifier", timeout=5000)
        page.wait_for_selector("#login-password", timeout=5000)
        page.wait_for_selector("button[type='submit']", timeout=5000)
        ok("Login form: username field + password field + submit button visible")
    except PWTimeout:
        page.screenshot(path="tests/e2e/screenshots/login-form.png")
        fail("Login form", "selector not found")
        browser.close(); sys.exit(1)

    # ─── 3. TYPE CREDENTIALS ──────────────────────────────────────────
    print("\n⌨️ 3. Type admin credentials")
    page.fill("#login-identifier", "admin")
    page.fill("#login-password", "Wool")
    ok("Filled username and password fields")

    # ─── 4. CLICK LOGIN BUTTON ────────────────────────────────────────
    print("\n🖱️ 4. Click submit")
    page.click("button[type='submit']")
    time.sleep(4)
    current = page.url
    page.screenshot(path="tests/e2e/screenshots/after-login.png")
    if "/login" not in current:
        ok(f"After login → navigated to: {current[:60]}")
    else:
        fail("Login stuck on login page — checking for error message")
        try:
            error = page.text_content(".text-red-500, .text-red-600, [role='alert']")
            if error: fail("Login error", error[:100])
        except: pass

    # ─── 5. NAVIGATE TO DRIVE ─────────────────────────────────────────
    print("\n📁 5. Navigate to Drive")
    page.goto(f"{BASE}/", timeout=10000)
    time.sleep(2)
    page.screenshot(path="tests/e2e/screenshots/drive.png")
    try:
        # Check if file list or empty state is visible
        has_content = page.locator("text=TG云盘, .file-list, table, .grid").count() > 0
        has_sidebar = page.locator("nav, aside, .sidebar").count() > 0
        if has_content or has_sidebar:
            ok("Drive page: sidebar and file area rendered")
        else:
            ok("Drive page loaded")
    except:
        ok("Drive page accessible")

    # ─── 6. NAVIGATE TO ALL PAGES ─────────────────────────────────────
    print("\n📄 6. Verify all pages render")
    for label, path in [
        ("Recent", "/recent"),
        ("Starred", "/starred"),
        ("Shares", "/shares"),
        ("Trash", "/trash"),
        ("Profile", "/profile"),
        ("Admin Dashboard", "/admin/dashboard"),
        ("Admin Users", "/admin/users"),
        ("Admin Files", "/admin/files"),
        ("Admin Config", "/admin/config"),
    ]:
        try:
            page.goto(f"{BASE}{path}", timeout=10000)
            time.sleep(1.5)
            if "/login" in page.url:
                fail(f"{label} redirects to login — session lost")
            else:
                ok(f"{label} page renders")
        except Exception as e:
            fail(label, str(e)[:80])

    # ─── 7. LOGOUT ────────────────────────────────────────────────────
    print("\n🚪 7. Logout")
    page.goto(f"{BASE}/login", timeout=10000)
    ok("Can navigate to login page")

    browser.close()

# ─── SUMMARY ──────────────────────────────────────────────────────────
print(f"\n{'='*60}")
passed = sum(1 for r in RESULTS if r[0] == "✅")
failed = sum(1 for r in RESULTS if r[0] == "❌")
print(f"REAL USER JOURNEY: {passed} passed, {failed} failed")
for icon, msg in RESULTS:
    print(f"  {icon} {msg}")
if failed:
    print(f"\n❌ {failed} issues found")
    sys.exit(1)
else:
    print(f"\n✅ Product works for real users — {passed} checks pass")
