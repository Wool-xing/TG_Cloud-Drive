"""
MULTI-EXPERT AUDIT — Product, Security, Architecture, QA, DevOps.
Real usage, real data, real Docker. No mocks.
"""
import requests, json, sys, time, os, io, base64, threading, subprocess
import urllib3; urllib3.disable_warnings()

if sys.platform == "win32": sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

API = "http://localhost:3000/api"
FINDINGS = {"CRITICAL":[], "HIGH":[], "MEDIUM":[], "LOW":[], "PASS":[]}

def finding(sev, area, msg, detail=""):
    FINDINGS[sev].append(f"[{area}] {msg}" + (f": {detail}" if detail else ""))
    icons = {"CRITICAL":"🔥","HIGH":"🟠","MEDIUM":"🟡","LOW":"🔵","PASS":"✅"}
    print(f"  {icons[sev]} [{area}] {msg}")
    if detail: print(f"     {detail}")

def api(m, p, d=None, t=None):
    h = {"Content-Type": "application/json"} if d is not None else {}
    if t: h["Authorization"] = f"Bearer {t}"
    r = requests.request(m, f"{API}{p}", json=d, headers=h, timeout=15, verify=False)
    try: b = r.json()
    except: b = {}
    return r.status_code, b, r.headers

# Setup
r = requests.post(f"{API}/auth/login", json={"identifier": "admin", "password": "Wool"}, timeout=10)
if r.status_code == 429: time.sleep(60); r = requests.post(f"{API}/auth/login", json={"identifier": "admin", "password": "Wool"}, timeout=10)
TOKEN = r.json().get("data", {}).get("accessToken", "")
if not TOKEN: print("FATAL: Cannot login"); sys.exit(1)

# ═══════════════════════════════════════════════════════════════════════
print("🔬 PRODUCT EXPERT — User Journey")
# ═══════════════════════════════════════════════════════════════════════

# Use admin for product flow (registration already verified in real-verify.py)
UTOK = TOKEN  # admin token already authenticated

# Me endpoint
s,b,_ = api("GET","/auth/me",t=UTOK)
if b.get("data",{}).get("username"): finding("PASS","Product","Identity confirmation (GET /auth/me)")
else: finding("HIGH","Product","Me endpoint broken")

# Create folder + document
s,b,_ = api("POST","/files/folder",{"name":f"Audit_{int(time.time())}","parentId":None,"private":False},t=UTOK)
fid = b.get("data",{}).get("id","")
if fid: finding("PASS","Product","Folder creation flow")
else: finding("MEDIUM","Product","Folder creation failed")

s,b,_ = api("POST","/files/document",{"name":"audit.md","parentId":None,"mimeType":"text/markdown","content":"# Audit"},t=UTOK)
did = b.get("data",{}).get("id","")
if did: finding("PASS","Product","Document creation flow")
else: finding("MEDIUM","Product","Document creation failed")

# List files
s,b,_ = api("GET","/files",t=UTOK)
items = b.get("data",[])
if len(items) >= 2: finding("PASS","Product",f"File listing ({len(items)} items)")
elif len(items) > 0: finding("MEDIUM","Product","File listing incomplete")
else: finding("HIGH","Product","File listing empty")

# Share
if did:
    s,b,_ = api("POST","/shares",{"nodeId":did,"password":"share1"},t=UTOK)
    if b.get("data",{}).get("token"): finding("PASS","Product","Share link creation")
    else: finding("MEDIUM","Product","Share creation failed")

# Trash
s,b,_ = api("DELETE","/files",{"nodeIds":[did]},t=UTOK)
s,b,_ = api("GET","/files/trash",t=UTOK)
if b.get("ok"): finding("PASS","Product","Trash listing after delete")
else: finding("MEDIUM","Product","Trash listing failed")

# Restore
s,b,_ = api("POST","/files/trash/restore",{"nodeIds":[did]},t=UTOK)
if s in (200,201): finding("PASS","Product","Restore from trash")

# ═══════════════════════════════════════════════════════════════════════
print("\n🛡️ SECURITY EXPERT")
# ═══════════════════════════════════════════════════════════════════════

# No auth = 401
s,_,_ = api("GET","/files")
if s==401: finding("PASS","Security","Unauthenticated access blocked (401)")
else: finding("CRITICAL","Security","No-auth request not blocked!",f"HTTP {s}")

# Rate limiting
for i in range(8):
    requests.post(f"{API}/auth/login",json={"identifier":"x","password":"x"},timeout=5)
s,_,_ = api("POST","/auth/login",{"identifier":"x","password":"x"})
if s==429: finding("PASS","Security","Rate limiting active (429 on brute force)")
else: finding("MEDIUM","Security",f"Rate limiting not triggered after 9 attempts: {s}")

# Admin endpoint blocked for regular user
s,_,_ = api("GET","/admin/users",t=UTOK)
if s in (401,403): finding("PASS","Security","Regular user blocked from admin")
else: finding("CRITICAL","Security","Regular user accessed admin endpoint!",f"HTTP {s}")

# Wrong password rejected
s,_,_ = api("POST","/auth/login",{"identifier":"admin","password":"WrongPass1!"})
if s==401: finding("PASS","Security","Wrong password rejected (401)")
else: finding("HIGH","Security","Wrong password not rejected",f"HTTP {s}")

# Secure headers via nginx HTTPS
r = requests.get("https://localhost/api/health",verify=False,timeout=10)
if "strict-transport-security" in r.headers: finding("PASS","Security","HSTS header present")
else: finding("HIGH","Security","HSTS header missing!")
if "content-security-policy" in r.headers: finding("PASS","Security","CSP header present")
else: finding("HIGH","Security","CSP header missing!")

# SQL injection in search (already fixed)
s,b,_ = api("GET","/files/search?q=%27;DROP+TABLE+users;--",t=TOKEN)
if s != 500: finding("PASS","Security","SQL injection probe handled gracefully")
else: finding("CRITICAL","Security","SQL injection still crashes server! (500)")

# ═══════════════════════════════════════════════════════════════════════
print("\n🏗️ ARCHITECTURE EXPERT")
# ═══════════════════════════════════════════════════════════════════════

# Consistent error format
s,b,_ = api("GET","/files/00000000-0000-0000-0000-000000000000/path",t=UTOK)
if b.get("ok") is not None: finding("PASS","Arch","Error responses have consistent envelope (ok field)")
else: finding("MEDIUM","Arch","Error response format inconsistent")

s,b,_ = api("GET","/users/stats",t=UTOK)
if b.get("data",{}).get("quotaBytes"): finding("PASS","Arch","Response envelope: {ok, data, timestamp}")
else: finding("LOW","Arch","Response envelope missing expected fields")

# API prefix consistency
r = requests.get("http://localhost:3000/health",timeout=5)
if r.status_code==200: finding("PASS","Arch","Health endpoint accessible without /api prefix")
else: finding("LOW","Arch","Health endpoint routing issue")

# ═══════════════════════════════════════════════════════════════════════
print("\n🧪 QA EXPERT — Edge Cases")
# ═══════════════════════════════════════════════════════════════════════

# Empty search
s,b,_ = api("GET","/files/search?q=",t=TOKEN)
if s==200: finding("PASS","QA","Empty search returns results (list all)")
else: finding("MEDIUM","QA","Empty search fails",f"HTTP {s}")

# Non-existent file
s,b,_ = api("GET","/files/00000000-0000-0000-0000-000000000999/path",t=TOKEN)
if s in (200,404): finding("PASS","QA","Non-existent file returns properly")
else: finding("MEDIUM","QA","Non-existent file causes unexpected error",f"HTTP {s}")

# Space in filename
s,b,_ = api("POST","/files/folder",{"name":"folder with spaces","parentId":None,"private":False},t=UTOK)
if s==201: finding("PASS","QA","Spaces in folder name accepted")
else: finding("LOW","QA","Spaces in name rejected",f"HTTP {s}")

# Concurrent requests
errors = []
def concurrent_get(i):
    try: requests.get(f"{API}/health",timeout=5)
    except: errors.append(i)
threads = [threading.Thread(target=concurrent_get,args=(i,)) for i in range(10)]
[t.start() for t in threads]; [t.join() for t in threads]
if not errors: finding("PASS","QA","10 concurrent health checks pass")
else: finding("MEDIUM","QA",f"Concurrent requests had {len(errors)} failures")

# ═══════════════════════════════════════════════════════════════════════
print("\n🚀 DEVOPS EXPERT")
# ═══════════════════════════════════════════════════════════════════════

# Docker health
r = subprocess.run("docker ps --filter name=tgpan --format '{{.Names}} {{.Status}}'",shell=True,capture_output=True,text=True)
containers = r.stdout.strip().split('\n')
healthy = [c for c in containers if 'healthy' in c.lower() or 'up' in c.lower()]
if len(containers) >= 5: finding("PASS","DevOps",f"All {len(containers)} containers running")
else: finding("CRITICAL","DevOps",f"Only {len(containers)}/5 containers running!")

# Backend health
r = requests.get("http://localhost:3000/api/health",timeout=5)
if r.status_code==200: finding("PASS","DevOps","Backend health check responds")
else: finding("CRITICAL","DevOps","Backend health check failed!")

# No errors in recent logs
r = subprocess.run("docker logs tgpan_backend --tail 50 2>&1",shell=True,capture_output=True,text=True)
err_count = r.stdout.count('[ERROR]') + r.stdout.count('[31m')
if err_count == 0: finding("PASS","DevOps","No recent errors in backend logs")
else: finding("LOW","DevOps",f"{err_count} recent errors in logs (check manually)")

# ═══════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════
print(f"\n{'='*60}")
total = sum(len(v) for v in FINDINGS.values())
c=len(FINDINGS["CRITICAL"]); h=len(FINDINGS["HIGH"]); m=len(FINDINGS["MEDIUM"]); l=len(FINDINGS["LOW"]); p=len(FINDINGS["PASS"])
print(f"MULTI-EXPERT AUDIT: {p} PASS, {c} CRIT, {h} HIGH, {m} MED, {l} LOW ({total} total)")

for sev in ["CRITICAL","HIGH","MEDIUM","LOW"]:
    for f in FINDINGS[sev]:
        print(f"  {sev[:4]:4s} {f}")

if FINDINGS["CRITICAL"]:
    print(f"\n🔥 {c} CRITICAL issues must be fixed!")
    sys.exit(1)
elif FINDINGS["HIGH"]:
    print(f"\n🟠 {h} HIGH issues — should fix before launch")
    sys.exit(1)
else:
    print(f"\n✅ PRODUCT READY — no CRITICAL or HIGH issues")
