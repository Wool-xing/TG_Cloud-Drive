"""Verify path traversal fix on localProxy"""
import requests

BASE = "http://localhost:3000"
r = requests.post(f"{BASE}/api/auth/login", json={"identifier": "admin", "password": "Wool"}, timeout=10)
TOKEN = r.json().get("data", {}).get("accessToken", "")

# Path traversal attempt
r = requests.get(f"{BASE}/api/files/local-proxy/..%2f..%2f.env", headers={"Authorization": f"Bearer {TOKEN}"})
print(f"Path traversal: HTTP {r.status_code} ok={r.json().get('ok')} msg={r.json().get('message','')[:80]}")

# Normal key
r = requests.get(f"{BASE}/api/files/local-proxy/abc-123", headers={"Authorization": f"Bearer {TOKEN}"})
print(f"Normal key: HTTP {r.status_code} msg={r.json().get('message','')[:80]}")

# Valid UUID key (should 404 not found, not 400)
r = requests.get(f"{BASE}/api/files/local-proxy/00000000-0000-0000-0000-000000000000", headers={"Authorization": f"Bearer {TOKEN}"})
print(f"Valid UUID (missing): HTTP {r.status_code} msg={r.json().get('message','')[:80]}")
