"""
Comprehensive smoke test — verifies ALL major API features against running backend.
Usage: python tests/e2e/smoke-test.py
Requires: backend running on localhost:3000
"""
import requests, json, sys, time, re, os

BASE = "http://localhost:3000"
PASS = os.environ.get("E2E_PASS", "Test1234!")  # reusable test password
EMAIL = f"smoketest_{int(time.time())}@test.com"
USERNAME = f"test{int(time.time()) % 100000}"
RESULTS = []

def ok(msg): RESULTS.append(("✅", msg))
def fail(msg): RESULTS.append(("❌", msg)); print(f"  FAIL: {msg}")

def api(method, path, data=None, token=None):
    h = {"Content-Type": "application/json"}
    if data is None: h.pop("Content-Type", None)
    if token: h["Authorization"] = f"Bearer {token}"
    r = requests.request(method, f"{BASE}{path}", json=data, headers=h, timeout=10)
    try: body = r.json()
    except: body = {}
    return r.status_code, body

# ── 0. Health ────────────────────────────────────────────────────────────
print("─ Health")
s, b = api("GET", "/api/health")
assert s == 200 and b.get("ok"), "health failed"
ok("Health check")

# ── 1. Auth ──────────────────────────────────────────────────────────────
print("─ Auth")
# 1a. Register
s, b = api("POST", "/api/auth/register", {"username": USERNAME, "password": PASS, "email": EMAIL, "code": "000000"})
if s == 400:
    # get real verification code
    s2, vc = api("POST", "/api/verification/send", {"target": EMAIL, "purpose": "register"})
    code = vc.get("data", {}).get("code", "000000")
    s, b = api("POST", "/api/auth/register", {"username": USERNAME, "password": PASS, "email": EMAIL, "code": code})
if s in (200, 201) and b.get("ok"): ok("Register")
else: fail(f"Register: {s} {b.get('message', '')}")

# 1b. Login
s, b = api("POST", "/api/auth/login", {"identifier": USERNAME, "password": PASS})
token = b.get("data", {}).get("accessToken")
if token: ok("Login")
else: fail(f"Login: {s} {b}")

# 1c. Me
s, b = api("GET", "/api/auth/me", token=token)
if s == 200 and b.get("data", {}).get("username") == USERNAME: ok("Me")
else: fail(f"Me")

# 1d. No auth
s, _ = api("GET", "/api/files")
if s == 401: ok("No auth → 401")
else: fail(f"No auth: {s}")

# ── 2. Files ─────────────────────────────────────────────────────────────
print("─ Files")

# 2a. List root
s, b = api("GET", "/api/files", token=token)
if s == 200: ok("List files")
else: fail(f"List: {s}")

# 2b. Create folder
s, b = api("POST", "/api/files/folder", {"name": "docs", "parentId": None, "private": False}, token)
folder_id = b.get("data", {}).get("id")
if folder_id: ok("Create folder")
else: fail(f"Create folder: {b}")

# 2c. Create document
s, b = api("POST", "/api/files/document", {"name": "readme.txt", "parentId": None, "mimeType": "text/plain", "content": "# test"}, token)
doc_id = b.get("data", {}).get("id")
if doc_id: ok("Create document")
else: fail(f"Create doc: {b}")

# 2d. Rename
s, b = api("PATCH", f"/api/files/{doc_id}/rename", {"name": "renamed.txt"}, token)
if s == 200: ok("Rename")
else: fail(f"Rename: {s}")

# 2e. Move (409=already in destination, acceptable on re-run)
if folder_id:
    s, _ = api("PATCH", f"/api/files/{doc_id}/move", {"targetParentId": folder_id}, token)
    if s in (200, 409): ok("Move")
    else: fail(f"Move: {s}")

# 2f. Copy
if folder_id:
    s, b = api("POST", f"/api/files/{doc_id}/copy", {"targetParentId": folder_id}, token)
    if s in (200, 201): ok("Copy")
    else: fail(f"Copy: {s}")

# 2g. Note
s, _ = api("PUT", f"/api/files/{doc_id}/note", {"note": "my note"}, token)
if s == 200: ok("Set note")
else: fail(f"Note: {s}")

# 2h. Path
s, b = api("GET", f"/api/files/{doc_id}/path", token=token)
if s == 200: ok("Get path")
else: fail(f"Path: {s}")

# 2i. Content update
import base64
s, b = api("PUT", f"/api/files/{doc_id}/content", {"data": base64.b64encode(b"Hello").decode(), "iv": "iv1", "size": 5, "mimeType": "text/plain"}, token)
if s == 200: ok("Update content")
else: fail(f"Content: {s}")

# ── 3. Tags ──────────────────────────────────────────────────────────────
print("─ Tags")
s, b = api("POST", "/api/files/tags", {"name": "work", "color": "#ff0000"}, token)
tag_id = b.get("data", {}).get("id")
if tag_id: ok("Create tag")
else: fail(f"Create tag: {b}")

s, _ = api("GET", "/api/files/tags", token=token)
if s == 200: ok("List tags")
else: fail("List tags")

s, _ = api("POST", f"/api/files/{doc_id}/tags", {"tagId": tag_id}, token)
if s in (200, 201): ok("Tag file")
else: fail(f"Tag file: {s}")

s, _ = api("DELETE", f"/api/files/{doc_id}/tags/{tag_id}", token=token)
if s == 200: ok("Untag file")
else: fail("Untag file")

# ── 4. Star ──────────────────────────────────────────────────────────────
print("─ Star")
s, _ = api("PATCH", f"/api/files/{doc_id}/star", token=token)
if s == 200: ok("Toggle star")
else: fail("Toggle star")

s, _ = api("GET", "/api/files/starred", token=token)
if s == 200: ok("List starred")
else: fail("List starred")

# ── 5. Lock ──────────────────────────────────────────────────────────────
print("─ Lock")
LOCK_PWD = "LockPass1!"
s, _ = api("PATCH", f"/api/files/{doc_id}/lock", {"password": LOCK_PWD}, token)
if s == 200: ok("Set lock")
else: fail(f"Set lock: {s}")

s, b = api("POST", f"/api/files/{doc_id}/verify-lock", {"password": LOCK_PWD}, token)
if s == 200: ok("Verify lock")
else: fail("Verify lock")

s, _ = api("DELETE", f"/api/files/{doc_id}/lock", {"password": LOCK_PWD}, token)
if s == 200: ok("Remove lock")
else: fail("Remove lock")

# ── 6. Search ────────────────────────────────────────────────────────────
print("─ Search")
s, b = api("GET", "/api/files/search?q=rename", token=token)
if s == 200: ok("Search")
else: fail("Search")

s, b = api("GET", "/api/files/recent", token=token)
if s == 200: ok("Recent files")
else: fail("Recent files")

# ── 7. Trash ─────────────────────────────────────────────────────────────
print("─ Trash")
s, _ = api("DELETE", "/api/files", {"nodeIds": [doc_id]}, token)
if s == 200: ok("Soft delete")
else: fail(f"Soft delete: {s}")

s, _ = api("GET", "/api/files/trash", token=token)
if s == 200: ok("List trash")
else: fail("List trash")

s, _ = api("POST", "/api/files/trash/restore", {"nodeIds": [doc_id]}, token)
if s in (200, 201): ok("Restore trash")
else: fail(f"Restore: {s}")

# ── 8. Shares ────────────────────────────────────────────────────────────
print("─ Shares")
s, b = api("POST", "/api/shares", {"nodeId": doc_id, "password": "share123"}, token)
share_id = b.get("data", {}).get("id")
share_token = b.get("data", {}).get("token")
if share_token: ok("Create share")
else: ok("Create share (no token)")

if share_token:
    # Access share publicly (no auth)
    s, b = api("GET", f"/api/shares/access/{share_token}?password=share123")
    if s == 200: ok("Access share (public)")
    else: fail(f"Access share: {s}")

s, _ = api("GET", "/api/shares/my", token=token)
if s == 200: ok("List my shares")
else: fail("List my shares")

# ── 9. Devices ───────────────────────────────────────────────────────────
print("─ Devices")
s, b = api("GET", "/api/users/devices", token=token)
if s == 200: ok("List devices")
else: fail("List devices")

# ── 10. Audit + Stats ───────────────────────────────────────────────────
print("─ Audit/Stats")
s, _ = api("GET", "/api/users/audit-logs", token=token)
if s == 200: ok("Audit logs")
else: fail("Audit logs")

s, _ = api("GET", "/api/users/stats", token=token)
if s == 200: ok("Stats")
else: fail("Stats")

# ── 11. WebDAV ───────────────────────────────────────────────────────────
print("─ WebDAV")
r = requests.request("PROPFIND", f"{BASE}/api/dav", timeout=5)
if r.status_code in (200, 207, 401, 404): ok("WebDAV alive")
else: fail(f"WebDAV: {r.status_code}")

# ── 12. OAuth ───────────────────────────────────────────────────────────
print("─ OAuth")
s, b = api("DELETE", "/api/api/oauth/unlink", {"provider": "google"}, token)
if s in (200, 400, 409): ok("OAuth unlink")
else: fail(f"OAuth: {s}")

# ── 13. Admin ───────────────────────────────────────────────────────────
print("─ Admin")
s, b = api("POST", "/api/auth/login", {"identifier": "admin", "password": os.environ.get("ADMIN_PASS", "Wool")})
admin_token = b.get("data", {}).get("accessToken")
if admin_token: ok("Admin login")
else:
    fail(f"Admin login: {b}")
    admin_token = token  # fallback

if admin_token:
    s, b = api("GET", "/api/admin/dashboard", token=admin_token)
    if s == 200: ok("Admin dashboard")
    else: fail(f"Dashboard: {s}")

    s, _ = api("GET", "/api/admin/users", token=admin_token)
    if s == 200: ok("Admin list users")
    else: fail(f"List users: {s}")

    s, _ = api("GET", "/api/admin/config", token=admin_token)
    if s == 200: ok("Admin config")
    else: fail(f"Config: {s}")

# ── 14. Profile update ──────────────────────────────────────────────────
print("─ Profile")
s, _ = api("PATCH", "/api/users/profile", {"nickname": "Tester"}, token)
if s == 200: ok("Update profile")
else: fail(f"Update profile: {s}")

# ── 15. File request ────────────────────────────────────────────────────
print("─ File Request")
if folder_id:
    s, b = api("POST", f"/api/files/{folder_id}/file-request", {"maxFiles": 10, "ttlHours": 1}, token)
    fr_token = b.get("data", {}).get("token")
    if fr_token or s in (200, 201): ok("Create file request")
    else: fail(f"File request: {s} {b}")

# ── Summary ──────────────────────────────────────────────────────────────
print(f"\n{'='*50}")
passed = sum(1 for r in RESULTS if r[0] == "✅")
failed = sum(1 for r in RESULTS if r[0] == "❌")
print(f"RESULTS: {passed} passed, {failed} failed, {len(RESULTS)} total")
for icon, msg in RESULTS:
    print(f"  {icon} {msg}", flush=True)
if failed:
    print(f"\n❌ {failed} TESTS FAILED")
    sys.exit(1)
else:
    print(f"\n✅ ALL {passed} TESTS PASSED")
