"""
A8 UI verify: SecurityTab 渲染 OTP 字段 + 发送按钮 (real browser).
"""
import io
import os
import sys
import secrets
import time
import requests
import subprocess
import urllib3

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

from playwright.sync_api import sync_playwright

BASE = "https://localhost"
API = f"{BASE}/api"
REDIS_PASS = "ek8fRnrqV6xDzEbrwsChqp9SMmNRRcELZ7oHXtBG"


def redis_del(key):
    subprocess.run(["docker", "exec", "tgpan_redis", "redis-cli", "-a", REDIS_PASS, "del", key],
                   capture_output=True, timeout=5, check=False)


def main():
    suffix = secrets.token_hex(3)
    email = f"a8ui_{suffix}@example.com"
    username = f"a8ui{suffix}"
    pw = f"A8ui!{suffix}A1"

    # Register via API (faster than UI)
    r = requests.post(f"{API}/verification/send",
                      json={"target": email, "purpose": "register"}, verify=False)
    code = r.json()["data"]["code"]
    r = requests.post(f"{API}/auth/register",
                      json={"username": username, "email": email, "code": code, "password": pw},
                      verify=False)
    assert r.status_code in (200, 201), r.text
    redis_del(f"vc:rate:{email}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(ignore_https_errors=True)
        page = ctx.new_page()

        # Login
        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.fill('input[autocomplete="username"]', email)
        page.fill('input[autocomplete="current-password"]', pw)
        page.click('button[type="submit"]')
        # Login redirects to "/" — wait for either /drive or any non-login page.
        page.wait_for_function("location.pathname !== '/login'", timeout=10000)
        page.wait_for_load_state("networkidle")

        # Profile / security tab
        page.goto(f"{BASE}/profile?tab=security", wait_until="networkidle")
        time.sleep(1)  # profile probe

        # Locate OTP input by placeholder
        otp_input = page.locator('input[placeholder*="验证码"]')
        send_btn = page.get_by_role("button", name="发送验证码")

        passes = 0
        if otp_input.count() == 1:
            print("  PASS  OTP input rendered when email bound")
            passes += 1
        else:
            print(f"  FAIL  OTP input count={otp_input.count()}")

        if send_btn.count() == 1:
            print("  PASS  Send OTP button rendered")
            passes += 1
        else:
            print(f"  FAIL  Send button count={send_btn.count()}")

        # Click send → wait for countdown text
        send_btn.click()
        page.wait_for_timeout(1500)
        if page.locator('button:has-text("后重发")').count() >= 1:
            print("  PASS  Countdown engaged after send")
            passes += 1
        else:
            print("  FAIL  Countdown did not engage")
            page.screenshot(path="a8_ui_fail.png")

        # Hint text mentions the bound email
        hint = page.locator(f'text=将发送到 {email}')
        if hint.count() >= 1:
            print("  PASS  Hint shows bound email")
            passes += 1
        else:
            print("  FAIL  Hint missing")

        browser.close()
        print(f"\nPASS {passes} / 4")
        sys.exit(0 if passes == 4 else 1)


if __name__ == "__main__":
    main()
