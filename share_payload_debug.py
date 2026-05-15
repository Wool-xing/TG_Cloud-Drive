"""Capture real /api/shares POST payload from frontend ShareDialog."""
import io
import sys
import json
import secrets
import requests
import urllib3
from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE = "https://localhost"


def main():
    suffix = secrets.token_hex(3)
    email = f"sh_{suffix}@example.com"
    username = f"sh{suffix}"
    pw = f"Sh!{suffix}A1"
    r = requests.post(f"{BASE}/api/verification/send",
                      json={"target": email, "purpose": "register"},
                      verify=False, timeout=10)
    code = r.json().get("data", {}).get("code")
    requests.post(f"{BASE}/api/auth/register",
                  json={"username": username, "email": email, "code": code, "password": pw},
                  verify=False, timeout=10)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(ignore_https_errors=True)
        page = ctx.new_page()

        captured = []
        page.on("request", lambda req:
            captured.append({"url": req.url, "method": req.method, "body": req.post_data})
            if "/api/shares" in req.url and req.method == "POST" else None)

        page.goto(f"{BASE}/login")
        page.wait_for_load_state("networkidle")
        page.fill('input[name="username"]', email)
        page.fill('input[name="password"]', pw)
        page.click('button[type="submit"]')
        page.wait_for_url(f"{BASE}/", timeout=10_000)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1500)

        # Create folder
        page.locator('button >> text=新建文件夹').first.click()
        page.wait_for_timeout(300)
        page.locator('input[placeholder="文件夹名称"]').fill(f"share_test_{suffix}")
        page.keyboard.press("Enter")
        page.wait_for_timeout(2000)

        # Right-click folder → 分享
        page.locator(f'text=share_test_{suffix}').first.click(button='right', force=True)
        page.wait_for_timeout(500)
        ctx_menu = page.locator('div.fixed.z-50.min-w-\\[180px\\]')
        ctx_menu.locator('button:has-text("分享")').click()
        page.wait_for_timeout(800)

        # Click "创建" / "生成分享链接" in ShareDialog (default = unlimited)
        for label in ["创建", "生成", "确定", "分享"]:
            btn = page.locator(f'div.fixed.inset-0 button:has-text("{label}")').first
            if btn.count() and btn.is_visible():
                btn.click()
                print(f"clicked button '{label}'")
                break
        page.wait_for_timeout(2500)

        for cap in captured:
            if "/api/shares" in cap["url"] and cap["method"] == "POST":
                print(f"\n=== captured POST {cap['url']} ===")
                print(f"body: {cap['body']}")
                try:
                    parsed = json.loads(cap['body'] or '{}')
                    print(f"parsed: {parsed}")
                    print(f"maxDownloads type: {type(parsed.get('maxDownloads')).__name__}")
                    print(f"maxDownloads value: {parsed.get('maxDownloads')!r}")
                except Exception as e:
                    print(f"parse fail: {e}")

        browser.close()


if __name__ == "__main__":
    main()
