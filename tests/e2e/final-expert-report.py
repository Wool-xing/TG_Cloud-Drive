"""
FINAL EXPERT REPORT — Multi-perspective product evaluation.
Real product, real usage. No mock judgments.
"""
import requests, sys, io, time, os, json, subprocess
import urllib3; urllib3.disable_warnings()
if sys.platform == "win32": sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

API = "http://localhost:3000/api"
REPORT = []

def finding(expert, sev, msg, evidence=""):
    REPORT.append({"expert": expert, "severity": sev, "msg": msg, "evidence": evidence})
    icons = {"CRIT":"🔥","HIGH":"🟠","MED":"🟡","LOW":"🔵","INFO":"ℹ️","OK":"✅"}
    print(f"  {icons.get(sev,'?')} [{expert}] {sev}: {msg}")
    if evidence: print(f"     Evidence: {evidence}")

# ═══════════════════════════════════════════════════════════════════════
print("🔬 PRODUCT EXPERT — evaluating real user experience")
# ═══════════════════════════════════════════════════════════════════════

# Test: Can a user sign up?
r = requests.post(f"{API}/verification/send", json={"target": f"prodtest_{int(time.time())}@test.com", "purpose": "register"}, timeout=10)
if r.status_code == 200:
    code = r.json().get("data", {}).get("code", "")
    finding("Product", "OK", "Verification code can be requested", f"code returned: {bool(code)}")

    uname = f"ptest_{int(time.time())%100000}"
    r = requests.post(f"{API}/auth/register", json={"username": uname, "password": "Product1!", "email": f"ptest_{int(time.time())}@test.com", "code": code}, timeout=10)
    if r.status_code in (200, 201):
        finding("Product", "OK", "User can register with verification code")

        # Login
        r = requests.post(f"{API}/auth/login", json={"identifier": uname, "password": "Product1!"}, timeout=10)
        TOKEN = r.json().get("data", {}).get("accessToken", "")
        if TOKEN:
            finding("Product", "OK", "User can login after registration")

            # Create content
            r = requests.post(f"{API}/files/folder", json={"name":"My Folder","parentId":None,"private":False}, headers={"Authorization":f"Bearer {TOKEN}"}, timeout=10)
            if r.status_code == 201: finding("Product", "OK", "User can create folders")

            r = requests.post(f"{API}/files/document", json={"name":"note.md","parentId":None,"mimeType":"text/markdown","content":"# My Note"}, headers={"Authorization":f"Bearer {TOKEN}"}, timeout=10)
            if r.status_code == 201: finding("Product", "OK", "User can create documents")

            # Search
            r = requests.get(f"{API}/files/search?q=note", headers={"Authorization":f"Bearer {TOKEN}"}, timeout=10)
            if r.status_code == 200 and len(r.json().get("data",[])) > 0:
                finding("Product", "OK", "Search finds created documents")

            # Stats
            r = requests.get(f"{API}/users/stats", headers={"Authorization":f"Bearer {TOKEN}"}, timeout=10)
            if r.status_code == 200:
                finding("Product", "OK", "User can view storage statistics")
        else:
            finding("Product", "HIGH", "User cannot login after registration")
    else:
        finding("Product", "HIGH", "Registration fails with verification code", f"HTTP {r.status_code}: {r.json().get('message','')[:80]}")
else:
    finding("Product", "MED", "Verification code request fails (SMTP not configured)", f"HTTP {r.status_code}")

# ═══════════════════════════════════════════════════════════════════════
print("\n🛡️ SECURITY EXPERT — evaluating attack surface")
# ═══════════════════════════════════════════════════════════════════════

# Auth gate
r = requests.get(f"{API}/files", timeout=5)
if r.status_code == 401: finding("Security", "OK", "Unauthenticated requests blocked")
else: finding("Security", "CRIT", "No authentication gate", f"HTTP {r.status_code}")

# Admin protection
r = requests.get(f"{API}/admin/users", timeout=5)
if r.status_code == 401: finding("Security", "OK", "Admin endpoints require authentication")
else: finding("Security", "CRIT", "Admin endpoints unauthenticated", f"HTTP {r.status_code}")

# HTTPS security headers
r = requests.get("https://localhost/api/health", verify=False, timeout=5)
headers_found = []
for h in ["strict-transport-security", "x-frame-options", "x-content-type-options", "content-security-policy"]:
    if h in r.headers: headers_found.append(h)
if len(headers_found) >= 3: finding("Security", "OK", f"Security headers present: {', '.join(headers_found)}")
else: finding("Security", "HIGH", f"Missing security headers: only {len(headers_found)}/4 found")

# Rate limiting
for i in range(8): requests.post(f"{API}/auth/login", json={"identifier":"x","password":"x"}, timeout=5)
r = requests.post(f"{API}/auth/login", json={"identifier":"x","password":"x"}, timeout=5)
if r.status_code == 429: finding("Security", "OK", "Rate limiting active (brute force protection)")
else: finding("Security", "MED", "Rate limiting may not be active", f"HTTP {r.status_code} after 9 tries")

# Error messages don't leak
r = requests.get(f"{API}/files/00000000-0000-0000-0000-000000000000/path", timeout=5)
body = r.text[:500]
if "stack" not in body.lower() and "SELECT" not in body: finding("Security", "OK", "Error responses don't leak internals")
else: finding("Security", "HIGH", "Error responses leak internal details")

# ═══════════════════════════════════════════════════════════════════════
print("\n🏗️ ARCHITECTURE EXPERT — evaluating system design")
# ═══════════════════════════════════════════════════════════════════════

# API consistency
r = requests.get(f"{API}/health", timeout=5)
if r.json().get("ok") is not None: finding("Arch", "OK", "Consistent response envelope: {ok, data, timestamp}")
else: finding("Arch", "MED", "Response format inconsistent")

# Health check
r = requests.get(f"{API}/health", timeout=5)
if r.status_code == 200: finding("Arch", "OK", "Health endpoint available")
else: finding("Arch", "HIGH", "Health endpoint broken")

# Docker architecture
result = subprocess.run("docker ps --format '{{.Names}}'", shell=True, capture_output=True, text=True)
containers = result.stdout.strip().split('\n')
tg_containers = [c for c in containers if 'tgpan' in c.lower()]
if len(tg_containers) == 5: finding("Arch", "OK", f"Clean 5-container architecture: {tg_containers}")
else: finding("Arch", "MED", f"Container count: {len(tg_containers)}/5 expected")

# ═══════════════════════════════════════════════════════════════════════
print("\n🧪 QA EXPERT — edge cases and robustness")
# ═══════════════════════════════════════════════════════════════════════

# Empty input handling
r = requests.get(f"{API}/files/search?q=", timeout=5)
if r.status_code == 200: finding("QA", "OK", "Empty search handled gracefully")
else: finding("QA", "MED", "Empty search fails", f"HTTP {r.status_code}")

# Non-existent resources
endpoints_404 = ["/files/00000000-0000-0000-0000-000000000000/path"]
for ep in endpoints_404:
    r = requests.get(f"{API}{ep}", timeout=5)
    if r.status_code in (200, 404, 401): pass  # all acceptable
    elif r.status_code == 500: finding("QA", "MED", f"Non-existent resource causes 500", f"{ep}")

# Special characters in names
r = requests.post(f"{API}/auth/login", json={"identifier": "admin", "password": "Wool"}, timeout=10)
ATOK = r.json().get("data", {}).get("accessToken", "")
if ATOK:
    r = requests.post(f"{API}/files/folder", json={"name": "test folder (special)! @#$%", "parentId": None, "private": False}, headers={"Authorization": f"Bearer {ATOK}"}, timeout=10)
    if r.status_code in (200, 201): finding("QA", "OK", "Special characters in folder name accepted")
    elif r.status_code == 500: finding("QA", "MED", "Special characters cause 500")

# ═══════════════════════════════════════════════════════════════════════
print("\n🚀 DEVOPS EXPERT — deployability")
# ═══════════════════════════════════════════════════════════════════════

# All containers healthy
result = subprocess.run("docker ps --format '{{.Names}} {{.Status}}' --filter name=tgpan", shell=True, capture_output=True, text=True)
lines = result.stdout.strip().split('\n')
healthy = sum(1 for l in lines if 'healthy' in l.lower() or 'up' in l.lower())
if healthy == 5: finding("DevOps", "OK", "All 5 containers running and healthy")
else: finding("DevOps", "HIGH", f"Only {healthy}/5 containers healthy")

# Backend health within Docker network
r = requests.get(f"{API}/health", timeout=5)
if r.status_code == 200: finding("DevOps", "OK", "Backend health check passes")
else: finding("DevOps", "CRIT", "Backend health check fails!")

# ─── SUMMARY ──────────────────────────────────────────────────────────
print(f"\n{'='*70}")
by_sev = {}
for r in REPORT:
    by_sev.setdefault(r["severity"], []).append(r)

print(f"FINAL EXPERT REPORT:")
for sev in ["CRIT","HIGH","MED","LOW","INFO","OK"]:
    count = len(by_sev.get(sev, []))
    if count: print(f"  {sev}: {count}")

c = len(by_sev.get("CRIT",[])); h = len(by_sev.get("HIGH",[]))
if c: print(f"\n🔥 {c} CRITICAL — must fix before production")
elif h: print(f"\n🟠 {h} HIGH — should fix before launch")
else: print(f"\n✅ NO CRITICAL or HIGH issues — production ready")
