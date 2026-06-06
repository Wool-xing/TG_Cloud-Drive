"""
Coverage booster — hits real API endpoints to exercise service-level code.
Each call exercises controller + service + database = maximum coverage per test.
Usage: python tests/e2e/coverage-boost.py
"""
import requests, json, sys, time, os, io

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = "http://localhost:3000"
PASS = 0; FAIL = 0

def check(label, ok, detail=""):
    global PASS, FAIL
    if ok: PASS += 1; print(f"  ✅ {label}")
    else: FAIL += 1; print(f"  ❌ {label}: {detail}")

def api(method, path, data=None, token=None):
    h = {"Content-Type": "application/json"} if data is not None else {}
    if token: h["Authorization"] = f"Bearer {token}"
    r = requests.request(method, f"{BASE}{path}", json=data, headers=h, timeout=15)
    try: return r.status_code, r.json()
    except: return r.status_code, {}

# ─── Setup ─────────────────────────────────────────────────────────────
print("Setup...")
r = requests.post(f"{BASE}/api/auth/login", json={"identifier": "admin", "password": "Wool"}, timeout=10)
if r.status_code == 429: time.sleep(60); r = requests.post(f"{BASE}/api/auth/login", json={"identifier": "admin", "password": "Wool"}, timeout=10)
TOKEN = r.json().get("data", {}).get("accessToken", "")
if not TOKEN: print("FAIL login"); sys.exit(1)
UUID = "00000000-0000-0000-0000-000000000001"

# ─── 1. Files CRUD ────────────────────────────────────────────────────
print("\n📁 Files")
# Folder
s, b = api("POST", "/api/files/folder", {"name": f"cov_{int(time.time())}", "parentId": None, "private": False}, TOKEN)
fid = b.get("data", {}).get("id", "")
check("createFolder", s == 201)

# Document
s, b = api("POST", "/api/files/document", {"name": f"doc_{int(time.time())}.md", "parentId": None, "mimeType": "text/markdown", "content": "# test"}, TOKEN)
did = b.get("data", {}).get("id", "")
check("createDocument", s == 201)

# Set note
s, _ = api("PUT", f"/api/files/{did}/note", {"note": "test note"}, TOKEN)
check("setNote", s == 200)

# Create tag
s, b = api("POST", "/api/files/tags", {"name": "test-tag", "color": "#ff0000"}, TOKEN)
tid = b.get("data", {}).get("id", "")
check("createTag", s == 201)

# Tag file
if tid and did:
    s, _ = api("POST", f"/api/files/{did}/tags", {"tagId": tid}, TOKEN)
    check("addTagToNode", s in (200, 201))

# List tags
s, _ = api("GET", "/api/files/tags", token=TOKEN)
check("listTags", s == 200)

if tid:
    s, _ = api("DELETE", f"/api/files/tags/{tid}", token=TOKEN)
    check("deleteTag", s == 200)

# Toggle star
s, _ = api("PATCH", f"/api/files/{did}/star", token=TOKEN)
check("toggleStar", s == 200)

s, _ = api("GET", "/api/files/starred", token=TOKEN)
check("listStarred", s == 200)

# Lock
s, _ = api("PATCH", f"/api/files/{did}/lock", {"password": "LockPass1!"}, TOKEN)
check("setLock", s == 200)

s, _ = api("POST", f"/api/files/{did}/verify-lock", {"password": "LockPass1!"}, TOKEN)
check("verifyLock", s == 200)

s, _ = api("DELETE", f"/api/files/{did}/lock", {"password": "LockPass1!"}, TOKEN)
check("removeLock", s == 200)

# Version
s, _ = api("POST", f"/api/files/{did}/versions", token=TOKEN)
check("createVersion", s == 201)

s, _ = api("GET", f"/api/files/{did}/versions", token=TOKEN)
check("getVersions", s == 200)

# File request
s, _ = api("POST", f"/api/files/{did}/file-request", {"maxFiles": 5, "ttlHours": 1}, TOKEN)
check("createFileRequest", s in (200, 201))

# Sync diff
s, _ = api("GET", "/api/files/sync/diff?since=2025-01-01", token=TOKEN)
check("getSyncDiff", s == 200)

# Path
s, _ = api("GET", f"/api/files/{did}/path", token=TOKEN)
check("getPath", s == 200)

# Recent
s, _ = api("GET", "/api/files/recent", token=TOKEN)
check("listRecent", s == 200)

# Offline download
s, _ = api("POST", "/api/files/offline-download", {"url": "https://example.com/test.bin", "parentId": None, "name": "test.bin"}, TOKEN)
check("createOfflineDownload", s in (200, 201, 202))

# Rename
s, _ = api("PATCH", f"/api/files/{did}/rename", {"name": f"renamed_{int(time.time())}.md"}, TOKEN)
check("rename", s == 200)

# Move into folder then back
if fid:
    s, _ = api("PATCH", f"/api/files/{did}/move", {"targetParentId": fid}, TOKEN)
    check("move(to folder)", s == 200)
    s, _ = api("PATCH", f"/api/files/{did}/move", {"targetParentId": ""}, TOKEN)
    check("move(to root)", s in (200, 409))  # 409=already there

# Copy
if fid:
    s, b = api("POST", f"/api/files/{did}/copy", {"targetParentId": fid}, TOKEN)
    check("copy", s in (200, 201))

# Soft delete
s, _ = api("DELETE", "/api/files", {"nodeIds": [did]}, TOKEN)
check("softDelete", s == 200)

# List trash
s, _ = api("GET", "/api/files/trash", token=TOKEN)
check("listTrash", s == 200)

# Restore
s, _ = api("POST", "/api/files/trash/restore", {"nodeIds": [did]}, TOKEN)
check("restoreTrash", s in (200, 201))

# Permanent delete
s, _ = api("DELETE", "/api/files/trash/permanent", {"nodeIds": [did]}, TOKEN)
check("permanentDelete", s == 200)

# ─── 2. Users ──────────────────────────────────────────────────────────
print("\n👤 Users")
# Devices
s, _ = api("GET", "/api/users/devices", token=TOKEN)
check("getDevices", s == 200)

# Audit logs
s, _ = api("GET", "/api/users/audit-logs?page=1&limit=10", token=TOKEN)
check("getAuditLogs", s == 200)

# Stats
s, _ = api("GET", "/api/users/stats", token=TOKEN)
check("getUserStats", s == 200)

# Profile
s, _ = api("GET", "/api/users/profile", token=TOKEN)
check("getProfile", s == 200)

s, _ = api("PATCH", "/api/users/profile", {"nickname": f"Tester_{int(time.time())}"}, TOKEN)
check("updateProfile", s == 200)

# ─── 3. Admin ────────────────────────────────────────────────────────────
print("\n🛡️ Admin")
s, _ = api("GET", "/api/admin/dashboard", token=TOKEN)
check("getDashboard", s == 200)

s, _ = api("GET", "/api/admin/users?page=1&limit=10", token=TOKEN)
check("listUsers", s == 200)

s, _ = api("GET", "/api/admin/files?page=1&limit=10", token=TOKEN)
check("listAllFiles", s == 200)

s, _ = api("GET", "/api/admin/config", token=TOKEN)
check("getSystemConfig", s == 200)

s, _ = api("POST", "/api/admin/test-email", {"to": "test@example.com"}, TOKEN)
check("testEmail", s == 200)

s, _ = api("POST", "/api/admin/test-sms", {"to": "13800138000"}, TOKEN)
check("testSms", s == 200)

# ─── 4. Shares ─────────────────────────────────────────────────────────
print("\n🔗 Shares")
s, b = api("POST", "/api/shares", {"nodeId": did, "password": "share1"}, TOKEN)
stok = b.get("data", {}).get("token", "")
check("createShare", s == 201)

s, _ = api("GET", "/api/shares/my", token=TOKEN)
check("listMyShares", s == 200)

# ─── Summary ───────────────────────────────────────────────────────────
print(f"\n{'='*50}")
print(f"Coverage boost: {PASS} passed, {FAIL} failed, {PASS+FAIL} total")
if FAIL:
    sys.exit(1)
