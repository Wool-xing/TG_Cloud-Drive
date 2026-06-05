"""Verify fixes for bugs found in bug-hunt.py"""
import requests, json, time, sys

BASE = "http://localhost:3000"

# Login as admin
r = requests.post(f"{BASE}/api/auth/login", json={"identifier": "admin", "password": "Wool"}, timeout=10)
if r.status_code == 429:
    print("Rate limited, waiting 60s...")
    time.sleep(60)
    r = requests.post(f"{BASE}/api/auth/login", json={"identifier": "admin", "password": "Wool"}, timeout=10)

TOKEN = r.json().get("data", {}).get("accessToken", "")
print(f"Admin login: {'OK' if TOKEN else 'FAIL ' + str(r.json())[:200]}")

if not TOKEN:
    sys.exit(1)

# Test 1: SQL injection in search
print("\n--- SQL injection fix ---")
r = requests.get(f"{BASE}/api/files/search?q=%27;DROP+TABLE+users;--", headers={"Authorization": f"Bearer {TOKEN}"})
print(f"q=';DROP TABLE users;--' → HTTP {r.status_code} ok={r.json().get('ok')} msg={r.json().get('message','')[:80]}")

r = requests.get(f"{BASE}/api/files/search?q=1%27+OR+%271%27=%271", headers={"Authorization": f"Bearer {TOKEN}"})
print(f"q=1' OR '1'='1 → HTTP {r.status_code} ok={r.json().get('ok')} msg={r.json().get('message','')[:80]}")

r = requests.get(f"{BASE}/api/files/search?q=normal_search", headers={"Authorization": f"Bearer {TOKEN}"})
print(f"q=normal_search → HTTP {r.status_code} ok={r.json().get('ok')}")

# Test 2: Null byte in folder name
print("\n--- Null byte fix ---")
r = requests.post(f"{BASE}/api/files/folder", json={"name": "\x00null.txt", "parentId": None, "private": False}, headers={"Authorization": f"Bearer {TOKEN}"})
print(f"Null byte name → HTTP {r.status_code} msg={r.json().get('message','')[:80]}")

# Test 3: Newline in folder name
r = requests.post(f"{BASE}/api/files/folder", json={"name": "a\nb.txt", "parentId": None, "private": False}, headers={"Authorization": f"Bearer {TOKEN}"})
print(f"Newline in name → HTTP {r.status_code} msg={r.json().get('message','')[:80]}")

# Test 4: Folder without name
r = requests.post(f"{BASE}/api/files/folder", json={}, headers={"Authorization": f"Bearer {TOKEN}"})
print(f"Folder without name → HTTP {r.status_code} msg={r.json().get('message','')[:80]}")

# Test 5: Non-UUID nodeId at rename
r = requests.patch(f"{BASE}/api/files/NOT-A-UUID/rename", json={"name": "test.txt"}, headers={"Authorization": f"Bearer {TOKEN}"})
print(f"Non-UUID rename → HTTP {r.status_code} msg={r.json().get('message','')[:80]}")

# Test 6: Negative page
r = requests.get(f"{BASE}/api/users/audit-logs?page=-1", headers={"Authorization": f"Bearer {TOKEN}"})
print(f"page=-1 → HTTP {r.status_code} msg={r.json().get('message','')[:80]}")

print(f"\n{'='*50}")
print("Verification complete.")
