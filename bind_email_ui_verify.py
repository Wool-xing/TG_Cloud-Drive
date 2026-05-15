"""UI smoke: ProfileTab 显绑邮箱按钮 + dialog 渲染."""
import io
import sys
import secrets
import requests
import urllib3

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

from playwright.sync_api import sync_playwright

BASE = "https://localhost"
API = f"{BASE}/api"


def random_cn_phone():
    return "138" + "".join(secrets.choice("0123456789") for _ in range(8))


def main():
    phone = random_cn_phone()
    suffix = secrets.token_hex(3)
    username = f"beui{suffix}"
    pw = f"Bui!{suffix}A1"

    r = requests.post(f"{API}/verification/send",
                      json={"target": phone, "purpose": "register"}, verify=False)
    code = r.json()["data"]["code"]
    r = requests.post(f"{API}/auth/register",
                      json={"username": username, "phone": phone, "code": code, "password": pw},
                      verify=False)
    assert r.status_code in (200, 201), r.text

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(ignore_https_errors=True)
        page = ctx.new_page()

        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.fill('input[autocomplete="username"]', phone)
        page.fill('input[autocomplete="current-password"]', pw)
        page.click('button[type="submit"]')
        page.wait_for_function("location.pathname !== '/login'", timeout=10000)
        page.wait_for_load_state("networkidle")

        page.goto(f"{BASE}/profile?tab=profile", wait_until="networkidle")
        page.wait_for_timeout(1500)

        passes = 0

        bind_btn = page.locator('button:has-text("绑定邮箱")')
        if bind_btn.count() == 1:
            print("  PASS  绑定邮箱 button shown for phone-only user")
            passes += 1
        else:
            print(f"  FAIL  button count={bind_btn.count()}")
            page.screenshot(path="bind_ui_fail1.png")

        # Empty input → readonly with placeholder
        if page.locator('input[placeholder="未绑定邮箱"]').count() == 1:
            print("  PASS  email field placeholder shown")
            passes += 1
        else:
            print("  FAIL  placeholder missing")

        # Open dialog
        bind_btn.click()
        page.wait_for_timeout(500)

        if page.locator('text=新邮箱').count() >= 1 and page.locator('text=邮箱验证码').count() >= 1:
            print("  PASS  Dialog renders 新邮箱 + 邮箱验证码")
            passes += 1
        else:
            print("  FAIL  Dialog fields missing")
            page.screenshot(path="bind_ui_fail2.png")

        if page.locator('button:has-text("确认绑定")').count() == 1:
            print("  PASS  Confirm button shown")
            passes += 1
        else:
            print("  FAIL  Confirm button missing")

        browser.close()
        print(f"\nPASS {passes} / 4")
        sys.exit(0 if passes == 4 else 1)


if __name__ == "__main__":
    main()
