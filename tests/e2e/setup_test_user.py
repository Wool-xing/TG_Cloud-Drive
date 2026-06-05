"""Create fresh test user for bug hunting"""
import requests, json, time
BASE = "http://localhost:3000"

# Get admin token
r = requests.post(f"{BASE}/api/auth/login", json={"identifier": "admin", "password": "Wool"})
admin_tok = r.json().get("data", {}).get("accessToken")
print(f"Admin: {'OK' if admin_tok else 'FAIL'}")

# Create test user via admin endpoint
uname = f"bugtest_{int(time.time()) % 100000}"
r = requests.post(f"{BASE}/api/admin/users", json={"username": uname, "password": "Test1234!", "role": "user"}, headers={"Authorization": f"Bearer {admin_tok}"})
print(f"Create user {uname}: {r.status_code} {r.json().get('ok')}")

# Login as test user
r = requests.post(f"{BASE}/api/auth/login", json={"identifier": uname, "password": "Test1234!"})
user_tok = r.json().get("data", {}).get("accessToken")
print(f"Login as {uname}: {'OK' if user_tok else 'FAIL'}")

print(f"\nTOKENS:")
print(f"ADMIN={admin_tok}")
print(f"USER={user_tok}")
print(f"USERNAME={uname}")
