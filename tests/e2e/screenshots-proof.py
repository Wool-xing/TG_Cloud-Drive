"""
Real proof — take actual screenshots of the product working.
"""
import sys, io, time, os
if sys.platform == "win32": sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

BASE = "https://localhost"
OUT = "tests/e2e/screenshots"
os.makedirs(OUT, exist_ok=True)

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context(ignore_https_errors=True)
    page = ctx.new_page()

    # Screenshot 1: Login page
    page.goto(f"{BASE}/login", timeout=15000)
    time.sleep(2)
    page.screenshot(path=f"{OUT}/1-login-page.png", full_page=True)
    print("✅ Screenshot: Login page → tests/e2e/screenshots/1-login-page.png")

    # Fill form
    page.fill("#login-identifier", "admin")
    page.fill("#login-password", "Wool")
    page.screenshot(path=f"{OUT}/2-login-filled.png", full_page=True)
    print("✅ Screenshot: Login form filled → 2-login-filled.png")

    # Submit
    page.click("button[type='submit']")
    time.sleep(4)
    page.screenshot(path=f"{OUT}/3-after-login.png", full_page=True)
    print("✅ Screenshot: After login attempt → 3-after-login.png")

    # Navigate to drive
    page.goto(f"{BASE}/", timeout=10000)
    time.sleep(2)
    page.screenshot(path=f"{OUT}/4-drive.png", full_page=True)
    print("✅ Screenshot: Drive page → 4-drive.png")

    # Navigate to profile
    page.goto(f"{BASE}/profile", timeout=10000)
    time.sleep(2)
    page.screenshot(path=f"{OUT}/5-profile.png", full_page=True)
    print("✅ Screenshot: Profile page → 5-profile.png")

    # Navigate to admin
    page.goto(f"{BASE}/admin/dashboard", timeout=10000)
    time.sleep(2)
    page.screenshot(path=f"{OUT}/6-admin.png", full_page=True)
    print("✅ Screenshot: Admin dashboard → 6-admin.png")

    browser.close()
    print(f"\n✅ All screenshots saved to {OUT}/")
