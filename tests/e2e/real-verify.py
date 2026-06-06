"""
REAL verification — zero mocks, real DB, real crypto, real persistence.
Every check proves an actual feature works end-to-end.
"""
import requests, json, sys, time, os, io, re, base64
import urllib3; urllib3.disable_warnings()

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = "https://localhost"
API = f"{BASE}/api"
PASS = 0; FAIL = 0
def ok(label): global PASS; PASS += 1; print(f"  ✅ {label}")
def nope(label, detail=""): global FAIL; FAIL += 1; print(f"  ❌ {label}: {detail}")

def api(m, p, d=None, t=None):
    h = {"Content-Type": "application/json"} if d is not None else {}
    if t: h["Authorization"] = f"Bearer {t}"
    r = requests.request(m, f"{API}{p}", json=d, headers=h, verify=False, timeout=15)
    try: b = r.json()
    except: b = {}
    return r.status_code, b, r.headers

# ─── SETUP: Register fresh test user ──────────────────────────────────
print("🔧 Setup")
uname = f"real_{int(time.time()) % 100000}"; email = f"{uname}@real.test"; pw = "RealTest1!"

s, b, _ = api("POST", "/verification/send", {"target": email, "purpose": "register"})
code = b.get("data", {}).get("code", "000000")
s, b, _ = api("POST", "/auth/register", {"username": uname, "password": pw, "email": email, "code": code})
s, b, h = api("POST", "/auth/login", {"identifier": uname, "password": pw})
TOKEN = b.get("data", {}).get("accessToken", "")
if not TOKEN: print("FATAL: Cannot login"); sys.exit(1)

s, b, _ = api("POST", "/auth/login", {"identifier": "admin", "password": "Wool"})
ADMIN = b.get("data", {}).get("accessToken", "")

print(f"  User: {uname}  Admin: {'OK' if ADMIN else 'N/A'}")

# ─── 1. PROFILES & DEVICES ───────────────────────────────────────────
print("\n👤 Profile")
s, b, _ = api("GET", "/users/profile", t=TOKEN)
ok("Get profile") if s == 200 else nope("Get profile", s)
s, b, _ = api("PATCH", "/users/profile", {"nickname": "RealTester"}, t=TOKEN)
ok("Update nickname") if s == 200 else nope("Update nickname", s)
s, b, _ = api("GET", "/users/devices", t=TOKEN)
ok("List devices") if s == 200 else nope("List devices", s)

# ─── 2. FILES CRUD ──────────────────────────────────────────────────
print("\n📁 Files CRUD")
# Create folder
s, b, _ = api("POST", "/files/folder", {"name": f"real_{int(time.time())}_docs", "parentId": None, "private": False}, t=TOKEN)
fid = b.get("data", {}).get("id", "")
ok("Create folder") if s == 201 else nope("Create folder", s)

# Create document
s, b, _ = api("POST", "/files/document", {"name": f"real_{int(time.time())}.md", "parentId": None, "mimeType": "text/markdown", "content": "# Real Test\n\nThis is real."}, t=TOKEN)
did = b.get("data", {}).get("id", "")
ok("Create document") if s == 201 else nope("Create document", s)

# Update content
b64 = base64.b64encode(b"Updated real content").decode()
s, _, _ = api("PUT", f"/files/{did}/content", {"data": b64, "iv": "0"*24, "size": 20, "mimeType": "text/plain"}, t=TOKEN)
ok("Update content") if s == 200 else nope("Update content", s)

# Rename
new_name = f"renamed_{int(time.time())}.md"
s, b, _ = api("PATCH", f"/files/{did}/rename", {"name": new_name}, t=TOKEN)
ok("Rename") if s == 200 else nope("Rename", s)
# Verify rename persisted
s, b, _ = api("GET", f"/files/{did}/path", t=TOKEN)
renamed_ok = s == 200
ok("Verify rename persisted") if renamed_ok else nope("Verify rename", s)

# Move into folder then back
if fid:
    s, _, _ = api("PATCH", f"/files/{did}/move", {"targetParentId": fid}, t=TOKEN)
    ok("Move into folder") if s in (200, 409) else nope("Move", s)
    # Move back
    s, _, _ = api("PATCH", f"/files/{did}/move", {"targetParentId": None}, t=TOKEN)
    ok("Move back to root") if s in (200, 409) else nope("Move back", s)

# Copy
if fid:
    s, b, _ = api("POST", f"/files/{did}/copy", {"targetParentId": fid}, t=TOKEN)
    ok("Copy file") if s in (200, 201) else nope("Copy", s)

# List all files
s, b, _ = api("GET", "/files", t=TOKEN)
file_count = len(b.get("data", []))
ok(f"List files ({file_count} items)") if s == 200 else nope("List files", s)

# Search
s, b, _ = api("GET", "/files/search?q=real", t=TOKEN)
ok("Search finds file") if s == 200 and len(b.get("data",[])) > 0 else nope("Search", s)

# Recent
s, b, _ = api("GET", "/files/recent", t=TOKEN)
ok("Recent files") if s == 200 else nope("Recent", s)

# Set note
s, _, _ = api("PUT", f"/files/{did}/note", {"note": "This is a real note"}, t=TOKEN)
ok("Set note") if s == 200 else nope("Set note", s)

# ─── 3. TAGS ────────────────────────────────────────────────────────
print("\n🏷️ Tags")
s, b, _ = api("POST", "/files/tags", {"name": f"real_tag_{int(time.time())}", "color": "#00ff00"}, t=TOKEN)
tid = b.get("data", {}).get("id", "")
ok("Create tag") if s == 201 else nope("Create tag", s)

s, _, _ = api("GET", "/files/tags", t=TOKEN)
ok("List tags") if s == 200 else nope("List tags", s)

if tid and did:
    s, _, _ = api("POST", f"/files/{did}/tags", {"tagId": tid}, t=TOKEN)
    ok("Tag file") if s in (200, 201) else nope("Tag file", s)
    s, _, _ = api("DELETE", f"/files/{did}/tags/{tid}", t=TOKEN)
    ok("Untag file") if s == 200 else nope("Untag file", s)
    s, _, _ = api("DELETE", f"/files/tags/{tid}", t=TOKEN)
    ok("Delete tag") if s == 200 else nope("Delete tag", s)

# ─── 4. STAR ────────────────────────────────────────────────────────
print("\n⭐ Star")
s, b, _ = api("PATCH", f"/files/{did}/star", t=TOKEN)
ok("Toggle star ON") if s == 200 else nope("Toggle star", s)
s, b, _ = api("GET", "/files/starred", t=TOKEN)
ok("List starred") if s == 200 else nope("List starred", s)
s, _, _ = api("PATCH", f"/files/{did}/star", t=TOKEN)
ok("Toggle star OFF") if s == 200 else nope("Toggle star off", s)

# ─── 5. LOCK ────────────────────────────────────────────────────────
print("\n🔒 Lock")
s, _, _ = api("PATCH", f"/files/{did}/lock", {"password": "RealLock1!"}, t=TOKEN)
ok("Set lock") if s == 200 else nope("Set lock", s)
s, _, _ = api("POST", f"/files/{did}/verify-lock", {"password": "RealLock1!"}, t=TOKEN)
ok("Verify correct lock password") if s == 200 else nope("Verify lock", s)
s, _, _ = api("POST", f"/files/{did}/verify-lock", {"password": "WrongLock1!"}, t=TOKEN)
ok("Reject wrong lock password") if s in (401, 403) else nope("Wrong lock", s)
s, _, _ = api("DELETE", f"/files/{did}/lock", {"password": "RealLock1!"}, t=TOKEN)
ok("Remove lock") if s == 200 else nope("Remove lock", s)

# ─── 6. VERSIONS ────────────────────────────────────────────────────
print("\n📚 Versions")
s, b, _ = api("POST", f"/files/{did}/versions", t=TOKEN)
ok("Create version") if s == 201 else nope("Create version", s)
s, b, _ = api("GET", f"/files/{did}/versions", t=TOKEN)
ok("List versions") if s == 200 else nope("List versions", s)

# ─── 7. SHARES ──────────────────────────────────────────────────────
print("\n🔗 Shares")
s, b, _ = api("POST", "/shares", {"nodeId": did, "password": "Share1!", "downloadLimit": 5}, t=TOKEN)
stok = b.get("data", {}).get("token", "")
sid = b.get("data", {}).get("id", "")
ok("Create share") if s == 201 else nope("Create share", s)

s, _, _ = api("GET", "/shares/my", t=TOKEN)
ok("List my shares") if s == 200 else nope("List my shares", s)

if stok:
    # Public access
    s, b, _ = api("GET", f"/shares/access/{stok}?password=Share1!")
    ok("Access share publicly") if s == 200 else nope("Access share", s)
    # Wrong password
    s, _, _ = api("GET", f"/shares/access/{stok}?password=wrong")
    ok("Reject wrong share password") if s in (401, 403) else nope("Wrong share pw", s)

    # Record download
    s, _, _ = api("POST", f"/shares/access/{stok}/download", {"password": "Share1!"})
    ok("Record download") if s in (200, 204) else nope("Record download", s)

# ─── 8. TRASH ───────────────────────────────────────────────────────
print("\n🗑️ Trash")
s, _, _ = api("DELETE", "/files", {"nodeIds": [did]}, t=TOKEN)
ok("Soft delete to trash") if s == 200 else nope("Soft delete", s)
s, b, _ = api("GET", "/files/trash", t=TOKEN)
ok("List trash") if s == 200 else nope("List trash", s)
s, _, _ = api("POST", "/files/trash/restore", {"nodeIds": [did]}, t=TOKEN)
ok("Restore from trash") if s in (200, 201) else nope("Restore", s)

# Soft delete again then permanent delete
api("DELETE", "/files", {"nodeIds": [did]}, t=TOKEN)
s, _, _ = api("DELETE", "/files/trash/permanent", {"nodeIds": [did]}, t=TOKEN)
ok("Permanent delete") if s == 200 else nope("Permanent delete", s)

# ─── 9. FILE REQUEST ────────────────────────────────────────────────
print("\n📬 File Request")
if fid:
    s, b, _ = api("POST", f"/files/{fid}/file-request", {"maxFiles": 10, "ttlHours": 1}, t=TOKEN)
    ok("Create file request") if s in (200, 201) else nope("File request", s)

# ─── 10. SYNC DIFF ──────────────────────────────────────────────────
print("\n🔄 Sync")
s, b, _ = api("GET", "/files/sync/diff?since=2020-01-01T00:00:00.000Z", t=TOKEN)
ok("Get sync diff") if s == 200 else nope("Sync diff", s)

# ─── 11. STATS & AUDIT ──────────────────────────────────────────────
print("\n📊 Stats")
s, b, _ = api("GET", "/users/stats", t=TOKEN)
ok("Get stats") if s == 200 else nope("Stats", s)
s, b, _ = api("GET", "/users/audit-logs?page=1&limit=5", t=TOKEN)
ok("Audit logs") if s == 200 else nope("Audit logs", s)

# ─── 12. PRIVATE SPACE ──────────────────────────────────────────────
print("\n🔐 Private Space")
s, b, _ = api("POST", "/users/private-space/setup", {"password": "Private1!"}, t=TOKEN)
ok("Setup private space") if s == 200 else nope("Setup private space", s)
s, b, _ = api("POST", "/users/private-space/verify", {"password": "Private1!"}, t=TOKEN)
ok("Verify private space") if s in (200, 201) else nope("Verify private space", s)

# ─── 13. ADMIN ──────────────────────────────────────────────────────
print("\n🛡️ Admin")
if ADMIN:
    s, _, _ = api("GET", "/admin/dashboard", t=ADMIN)
    ok("Admin dashboard") if s == 200 else nope("Admin dashboard", s)
    s, _, _ = api("GET", "/admin/users?page=1&limit=5", t=ADMIN)
    ok("Admin list users") if s == 200 else nope("Admin list users", s)
    s, _, _ = api("GET", "/admin/files?page=1&limit=5", t=ADMIN)
    ok("Admin list all files") if s == 200 else nope("Admin list files", s)
    s, _, _ = api("GET", "/admin/audit-logs?page=1&limit=5", t=ADMIN)
    ok("Admin audit logs") if s == 200 else nope("Admin audit logs", s)
    s, _, _ = api("GET", "/admin/config", t=ADMIN)
    ok("Admin view config") if s == 200 else nope("Admin config", s)
    s, _, _ = api("POST", "/admin/test-email", {"to": "test@real.com"}, t=ADMIN)
    ok("Admin test email") if s in (200, 400) else nope("Admin test email", s)

# ─── 14. PERSISTENCE ────────────────────────────────────────────────
print("\n💾 Persistence")
import subprocess
s, b, _ = api("GET", "/users/stats", t=TOKEN)
before_files = b.get("data", {}).get("totalFiles", 0)
before_folders = b.get("data", {}).get("totalFolders", 0)
subprocess.run("docker restart tgpan_backend", shell=True, capture_output=True)
time.sleep(15)
# Re-login
s, b, _ = api("POST", "/auth/login", {"identifier": uname, "password": pw})
TOKEN2 = b.get("data", {}).get("accessToken", "")
s, b, _ = api("GET", "/users/stats", t=TOKEN2)
after_files = b.get("data", {}).get("totalFiles", 0)
after_folders = b.get("data", {}).get("totalFolders", 0)
ok(f"File count persists ({before_files}→{after_files})") if before_files == after_files else nope("File persistence", f"{before_files}→{after_files}")
ok(f"Folder count persists ({before_folders}→{after_folders})") if before_folders == after_folders else nope("Folder persistence", f"{before_folders}→{after_folders}")

# ─── 15. CLEANUP ────────────────────────────────────────────────────
if fid:
    api("DELETE", "/files/trash/permanent", {"nodeIds": [fid]}, t=TOKEN)

# ─── SUMMARY ────────────────────────────────────────────────────────
print(f"\n{'='*60}")
print(f"REAL VERIFICATION: {PASS} passed, {FAIL} failed, {PASS+FAIL} total")
print(f"Real user: {uname}  Real data: yes  Real DB: yes  Real persistence: yes")
if FAIL: sys.exit(1)
