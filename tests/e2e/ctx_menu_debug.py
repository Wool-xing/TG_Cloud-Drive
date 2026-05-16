"""Debug context-menu action click."""
import io
import sys
import secrets
import requests
import urllib3
from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE = "https://localhost"
API = f"{BASE}/api"


def main():
    suffix = secrets.token_hex(3)
    email = f"ctx_{suffix}@example.com"
    username = f"ctx{suffix}"
    pw = f"Ctx!{suffix}A1"

    r = requests.post(f"{API}/verification/send", json={"target": email, "purpose": "register"},
                      verify=False, timeout=10)
    code = r.json().get("data", {}).get("code")
    requests.post(f"{API}/auth/register",
                  json={"username": username, "email": email, "code": code, "password": pw},
                  verify=False, timeout=10)
    print(f"registered {username}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(ignore_https_errors=True)
        page = ctx.new_page()

        msgs = []
        page.on("console", lambda m: msgs.append(f"[{m.type}] {m.text[:200]}"))
        page.on("pageerror", lambda e: msgs.append(f"[pageerror] {e}"))

        page.goto(f"{BASE}/login")
        page.wait_for_load_state("networkidle")
        page.fill('input[name="username"]', email)
        page.fill('input[name="password"]', pw)
        page.click('button[type="submit"]')
        page.wait_for_url(f"{BASE}/", timeout=10_000)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1500)

        # New folder: inline mode, Enter submits
        page.locator('button >> text=新建文件夹').first.click()
        page.wait_for_timeout(300)
        folder_name = f"ctxfolder_{suffix}"
        page.locator('input[placeholder="文件夹名称"]').fill(folder_name)
        page.keyboard.press("Enter")
        page.wait_for_timeout(2000)

        row_locator = page.locator(f'text={folder_name}').first
        if not row_locator.is_visible():
            print(f"FAIL: folder row not visible (folder={folder_name})")
            print("--- console ---")
            for m in msgs[-15:]: print(m)
            browser.close()
            return
        print(f"folder visible {folder_name}")

        row_locator.click(button='right', force=True)
        page.wait_for_timeout(500)

        # Context-menu container has min-w-[180px] (FileContextMenu.tsx L266).
        # Scope locators to it so toolbar buttons don't shadow.
        ctx_menu = page.locator('div.fixed.z-50.min-w-\\[180px\\]')
        ctx_visible = ctx_menu.count() > 0 and ctx_menu.first.is_visible()
        print(f"ctx menu div count={ctx_menu.count()} visible={ctx_visible}")

        rename_btns = ctx_menu.locator('button:has-text("重命名")')
        cnt = rename_btns.count()
        print(f"重命名 btn count (inside ctx menu)={cnt}")
        if cnt:
            visible = rename_btns.first.is_visible()
            print(f"重命名 btn visible={visible}")

            menu_info = page.evaluate("""() => {
                const btns = Array.from(document.querySelectorAll('button')).filter(b => /重命名|移动到|复制到|加密锁定|分享|预览|下载/.test(b.textContent || ''));
                return btns.map(b => ({
                    text: (b.textContent || '').trim().slice(0, 20),
                    disabled: b.disabled,
                    pointerEvents: getComputedStyle(b).pointerEvents,
                    visibility: getComputedStyle(b).visibility,
                    parentZIndex: getComputedStyle(b.parentElement.parentElement).zIndex
                }));
            }""")
            print(f"menu buttons:")
            for b in menu_info: print(f"  {b}")

            # Click 重命名 with force in case overlap
            rename_btns.first.click(force=True)
            page.wait_for_timeout(800)

            # Look for dialog
            h2_count = page.locator('h2:has-text("重命名")').count()
            print(f"after click: h2 重命名 count={h2_count}")

            overlay_info = page.evaluate("""() => {
                return Array.from(document.querySelectorAll('.fixed.inset-0')).map(d => ({
                    zIndex: getComputedStyle(d).zIndex,
                    visible: getComputedStyle(d).display !== 'none',
                    h2: d.querySelector('h2')?.textContent?.slice(0, 30) || '',
                    text: (d.innerText || '').slice(0, 80)
                }));
            }""")
            print(f"overlays after click:")
            for o in overlay_info: print(f"  {o}")

            # Check local state via React DevTools (won't work). Instead probe Zustand
            store_state = page.evaluate("""() => {
                try {
                    const s = JSON.parse(localStorage.getItem('auth') || '{}');
                    return { hasAuth: !!s?.state?.user };
                } catch { return null; }
            }""")
            print(f"auth state: {store_state}")

        print("--- console (last 20) ---")
        for m in msgs[-20:]: print(m)
        browser.close()


if __name__ == "__main__":
    main()
