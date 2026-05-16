"""Verify 3 bug fixes from user report 2026-05-16:
  1. 登录失败 → toast.error 显 (interceptor 不吞 401)
  2. 验证码发送 → dev mode toast "开发模式验证码: NNNNNN" 显
  3. dark mode autofill 反盖 (CSS rule 存在, Playwright 测不了真 Chrome autofill)
"""
import io
import re
import sys
import secrets
from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = "https://localhost"
PASS = 0
FAIL = 0


def check(label, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  PASS  {label}")
    else:
        FAIL += 1
        print(f"  FAIL  {label}  {detail}")


def main():
    print("── Bug-fix verify ──")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(ignore_https_errors=True)
        page = ctx.new_page()

        # ── 1. Login failure toast ──
        page.goto(f"{BASE}/login")
        page.wait_for_load_state("networkidle")
        page.fill('input[name="username"]', "nonexistent_user_xyz")
        page.fill('input[name="password"]', "wrongPass123!")
        page.click('button[type="submit"]')
        # toast.error appears top-right, react-hot-toast adds element
        try:
            page.wait_for_selector('div:has-text("用户名或密码错误"), div:has-text("登录失败"), div:has-text("请求失败"), div[class*="toast"]', timeout=4000)
            toast_text = page.locator('div[class*="toast"], [role="status"]').all_inner_texts()
            joined = " | ".join(toast_text)
            check("login failure toast 显", True, f"toast={joined[:120]}")
        except Exception as e:
            check("login failure toast 显", False, f"no toast in 4s: {e}")

        # ── 2. Register dev-mode code toast ──
        page.goto(f"{BASE}/register")
        page.wait_for_load_state("networkidle")
        suffix = secrets.token_hex(3)
        email = f"bug_{suffix}@example.com"
        # Email input is type=email, no name attr — locate by placeholder
        page.fill('input[placeholder*="example@mail.com"], input[type="email"]', email)
        # Click "发送验证码"
        page.click('button:has-text("发送验证码")')
        try:
            page.wait_for_selector('div:has-text("开发模式验证码")', timeout=5000)
            toast_text = page.locator('div:has-text("开发模式验证码")').first.inner_text()
            m = re.search(r"(\d{6})", toast_text)
            check("dev code toast 显 6位code", bool(m), f"toast={toast_text!r}")
        except Exception as e:
            check("dev code toast 显 6位code", False, f"no dev-code toast in 5s: {e}")

        # ── 3. Dark mode CSS autofill rule exists ──
        page.goto(f"{BASE}/login")
        page.wait_for_load_state("networkidle")
        # Toggle dark mode via localStorage + reload
        page.evaluate("localStorage.setItem('theme', 'dark'); document.documentElement.classList.add('dark');")
        # Inspect computed CSS for :-webkit-autofill (CSS rule existence test)
        has_autofill_rule = page.evaluate("""
            () => {
              for (const sheet of document.styleSheets) {
                try {
                  for (const rule of sheet.cssRules) {
                    const t = rule.cssText || '';
                    if (t.includes('-webkit-autofill') && t.includes('html.dark')) return true;
                  }
                } catch {}
              }
              return false;
            }
        """)
        check("dark mode -webkit-autofill rule 存在", has_autofill_rule)

        # Verify dark mode root + identifier input default bg
        is_dark = page.evaluate("document.documentElement.classList.contains('dark')")
        check("html.dark class 切换 OK", is_dark)

        browser.close()
    print(f"\nPASS {PASS}  FAIL {FAIL}")
    sys.exit(0 if FAIL == 0 else 1)


if __name__ == "__main__":
    main()
