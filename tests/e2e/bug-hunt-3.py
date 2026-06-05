"""
Bug hunt Phase 3 — quota bypass, error disclosure, rate-limit bypass, MIME attacks.
"""
import requests, json, sys, time, os, io, re, base64

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = "http://localhost:3000"
BUGS = []

def bug(sev, area, title, detail="", actual=""):
    BUGS.append({"severity": sev, "area": area, "title": title, "detail": detail, "actual": str(actual)[:200]})
    print(f"  {'🔥' if sev=='CRIT' else '🟠' if sev=='HIGH' else '🟡'} [{sev}] {title}")
    if detail: print(f"     {detail}")

def api(method, path, data=None, token=None, raw=False, hdrs=None):
    h = hdrs or {}
    if "Content-Type" not in h and not raw: h["Content-Type"] = "application/json"
    if token: h["Authorization"] = f"Bearer {token}"
    try:
        r = requests.request(method, f"{BASE}{path}", json=data if not raw else None,
                            data=json.dumps(data).encode() if not (raw or data is None) else None,
                            headers=h, timeout=10)
        try: body = r.json()
        except: body = {"_raw": r.text[:2000]}
        return r.status_code, body, r.headers
    except Exception as e:
        return None, str(e), {}

# Setup
print("Setup...")
r = requests.post(f"{BASE}/api/auth/login", json={"identifier": "admin", "password": "Wool"}, timeout=10)
if r.status_code == 429: time.sleep(60); r = requests.post(f"{BASE}/api/auth/login", json={"identifier": "admin", "password": "Wool"}, timeout=10)
TOKEN = r.json().get("data", {}).get("accessToken", "")
if not TOKEN: print("FAILED login"); sys.exit(1)
print(f"Admin OK")

# ── 13. QUOTA ATTACKS ──────────────────────────────────────────────────
print("\n📊 QUOTA ATTACKS")

# 13a. Check current quota
r = api("GET", "/api/users/stats", token=TOKEN)
quota = r[1].get("data", {}).get("quotaBytes", 0)
used = r[1].get("data", {}).get("usedBytes", 0)
print(f"  Quota: {used:,}/{quota:,} bytes ({used/quota*100:.1f}%)" if quota else "  Quota: unknown")

# 13b. Create documents until quota check
r = api("POST", "/api/files/document", {
    "name": "quota_test.txt", "parentId": None, "mimeType": "text/plain",
    "content": "x" * 10_000_000  # 10MB
}, TOKEN)
if r[0] in (200, 201): pass  # OK not exceeding quota
elif r[0] in (400, 413): pass  # Size limit enforced
elif r[0] == 500: bug("MED", "Quota", "Large document causes 500", f"HTTP {r[0]}")

# 13c. Quota bypass via renamed file
# Create small file, check if size tracking is correct
r = api("POST", "/api/files/document", {
    "name": f"q_small_{int(time.time())}.txt", "parentId": None,
    "mimeType": "text/plain", "content": "hello"
}, TOKEN)
if r[0] == 201:
    q_node = r[1].get("data", {}).get("id", "")
    # Check stats
    r2 = api("GET", "/api/users/stats", token=TOKEN)
    used2 = r2[1].get("data", {}).get("usedBytes", 0)
    if used2 == used: bug("LOW", "Quota", "usedBytes not updated after creating file", f"before={used} after={used2}")

# ── 14. ERROR DISCLOSURE ───────────────────────────────────────────────
print("\n💥 ERROR DISCLOSURE")

# 14a. Check if 500 errors leak stack traces
# Force various 500s and check response body
for path, data, label in [
    ("/api/files/folder", {"name": None, "parentId": None}, "null name"),
    ("/api/files/folder", '{"broken', "broken JSON body"),
]:
    r = requests.post(f"{BASE}{path}", data=data if isinstance(data, str) else None,
                      json=data if not isinstance(data, str) else None,
                      headers={"Content-Type": "application/json", "Authorization": f"Bearer {TOKEN}"},
                      timeout=10)
    body = r.text[:500]
    # Check for stack trace leak
    if "at " in body and (".ts:" in body or ".js:" in body):
        bug("HIGH", "ErrorDisclosure", f"Stack trace leaked in 500 response: {label}", body[:200])
    elif "SELECT" in body.upper() or "INSERT" in body.upper():
        bug("CRIT", "ErrorDisclosure", f"SQL query leaked in error response: {label}", body[:200])
    elif "password" in body.lower() or "secret" in body.lower() or "token" in body.lower():
        bug("CRIT", "ErrorDisclosure", f"Sensitive keyword in error response: {label}", body[:200])

# 14b. Check 404 response for information leakage
r = api("GET", "/api/files/00000000-0000-0000-0000-000000000999", token=TOKEN)
# 404 should not leak whether file exists in another user's scope

# 14c. Nginx error pages
r = requests.get("https://localhost/.env", verify=False, timeout=5)
if ".env" not in r.text.lower(): pass  # good, nginx blocks
if "DATABASE_URL" in r.text or "JWT_SECRET" in r.text:
    bug("CRIT", "ErrorDisclosure", ".env accessible via nginx!", r.text[:200])

# ── 15. RATE LIMIT BYPASS ──────────────────────────────────────────────
print("\n⏱️ RATE LIMIT BYPASS")

# 15a. Try IP spoofing via X-Forwarded-For
results = []
for i in range(3):
    r = requests.post(f"{BASE}/api/auth/login",
        json={"identifier": "admin", "password": "wrong"},
        headers={"X-Forwarded-For": f"10.0.{i}.1", "Content-Type": "application/json"},
        timeout=5)
    results.append(r.status_code)
if all(s == 401 for s in results):
    bug("MED", "RateLimit", "IP spoof via X-Forwarded-For bypasses rate limit", f"Statuses: {results}")
elif any(s == 429 for s in results):
    pass  # rate limiting works

# 15b. Rate limit on verification code send
# Send 5 codes rapidly
for i in range(5):
    r = requests.post(f"{BASE}/api/verification/send",
        json={"target": f"ratelimit{i}@test.com", "purpose": "register"},
        timeout=5)
    if r.status_code == 429 and i < 3:
        pass  # rate limiting working early
results2 = [r.status_code for r in [requests.post(f"{BASE}/api/verification/send",
    json={"target": f"ratelimit{i}@test.com", "purpose": "register"}, timeout=5) for i in range(5)]]
if all(s == 201 for s in results2[:5]):
    bug("HIGH", "RateLimit", "No rate limit on verification code send", f"5 sends: {results2}")

# ── 16. MIME / FILE TYPE ATTACKS ──────────────────────────────────────
print("\n📎 MIME ATTACKS")

# 16a. SVG with embedded script (stored XSS vector)
svg_payload = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
r = api("POST", "/api/files/document", {
    "name": "malicious.svg", "parentId": None,
    "mimeType": "image/svg+xml", "content": svg_payload
}, TOKEN)
if r[0] in (200, 201): pass  # accepted — frontend must protect, could be served as image
elif r[0] == 500: bug("MED", "MIME", "SVG with script causes 500", f"HTTP {r[0]}")

# 16b. HTML file uploaded as text/plain
html_payload = "<html><body><script>alert(1)</script></body></html>"
r = api("POST", "/api/files/document", {
    "name": "page.html", "parentId": None,
    "mimeType": "text/plain", "content": html_payload
}, TOKEN)
if r[0] in (200, 201): pass  # accepted — frontend should not render as HTML

# 16c. Dangerous MIME types
for mime in ["application/x-msdownload", "application/x-sh", "text/html", "application/javascript"]:
    r = api("POST", "/api/files/document", {
        "name": f"test_{mime.replace('/','_')}", "parentId": None,
        "mimeType": mime, "content": "test"
    }, TOKEN)
    if r[0] == 500: bug("MED", "MIME", f"MIME type '{mime}' causes 500", f"HTTP {r[0]}")

# 16d. Null byte in MIME type (content-type sniffing bypass)
r = api("POST", "/api/files/document", {
    "name": "evil.txt", "parentId": None,
    "mimeType": "text/plain\x00; application/javascript", "content": "alert(1)"
}, TOKEN)
if r[0] in (200, 201): bug("HIGH", "MIME", "Null byte in MIME type accepted — can bypass content-type checks", f"HTTP {r[0]}")
elif r[0] == 500: bug("MED", "MIME", "Null byte in MIME type causes 500", f"HTTP {r[0]}")

# ── 17. RESOURCE EXHAUSTION ────────────────────────────────────────────
print("\n💣 RESOURCE EXHAUSTION")

# 17a. Very long paths
deep_path = "/".join(["folder"] * 50)
r = requests.get(f"{BASE}/api/files/{deep_path}", headers={"Authorization": f"Bearer {TOKEN}"}, timeout=10)
if r.status_code == 500: bug("MED", "ResourceX", "50-depth path causes 500", f"HTTP {r.status_code}")
elif r.status_code in (400, 404, 414): pass

# 17b. Concurrent folder creation to exhaust quota/table space
import threading
errors = []
def make_folder(i):
    r = requests.post(f"{BASE}/api/files/folder",
        json={"name": f"concurrent_{int(time.time())}_{i}", "parentId": None, "private": False},
        headers={"Authorization": f"Bearer {TOKEN}"}, timeout=10)
    if r.status_code == 500: errors.append(i)

threads = []
for i in range(10):
    t = threading.Thread(target=make_folder, args=(i,))
    threads.append(t); t.start()
for t in threads: t.join()
if errors: bug("LOW", "ResourceX", f"{len(errors)}/10 concurrent folders caused 500", str(errors))

# ─── SUMMARY ─────────────────────────────────────────────────────────────
print(f"\n{'='*60}")
if not BUGS:
    print("🎉 NO BUGS in Phase 3!")
else:
    by_sev = {}
    for b in BUGS: by_sev.setdefault(b["severity"], []).append(b)
    print(f"🐛 {len(BUGS)} BUGS: {len(by_sev.get('CRIT',[]))} CRIT, {len(by_sev.get('HIGH',[]))} HIGH, {len(by_sev.get('MED',[]))} MED, {len(by_sev.get('LOW',[]))} LOW\n")
    for b in BUGS:
        print(f"  {b['severity']:5s} [{b['area']:15s}] {b['title']}")

sys.exit(1 if BUGS else 0)
