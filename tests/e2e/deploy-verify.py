"""
北极星0a验证 — 按启动指南模拟新手30分钟部署链路。
"""
import subprocess, os, requests, sys, io, time
if sys.platform == "win32": sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

API = "http://localhost:3000/api"
CHECKS = []

def check(step, ok, detail=""):
    CHECKS.append((step, ok, detail))
    icon = "✅" if ok else "❌"
    print(f"  {icon} {step}")
    if detail: print(f"     {detail}")

# 启动指南 Step 1: .env 模板
print("📋 Step 1: .env exists + has required fields")
base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
check("1a .env.example exists", os.path.exists(f"{base}/.env.example"))
env_path = f"{base}/.env"
if os.path.exists(env_path):
    with open(env_path, encoding='utf-8', errors='ignore') as f: env_content = f.read()
    check("1b .env has real values (no CHANGE_ME)", "CHANGE_ME" not in env_content)
else:
    check("1b .env exists", False)

# Step 2: TLS certs
print("\n🔒 Step 2: TLS certificates")
check("2a fullchain.pem exists", os.path.exists(f"{base}/certs/fullchain.pem"))
check("2b privkey.pem exists", os.path.exists(f"{base}/certs/privkey.pem"))

# Step 3: Docker compose
print("\n🐳 Step 3: Docker containers")
r = subprocess.run("docker ps --filter name=tgpan --format '{{.Names}}:{{.Status}}'",
                   shell=True, capture_output=True, text=True)
containers = r.stdout.strip().split('\n')
tg_count = sum(1 for c in containers if 'tgpan' in c)
check(f"3a All containers ({tg_count}/5)", tg_count == 5,
      ", ".join(c.split(':')[0] for c in containers))
healthy = sum(1 for c in containers if '(healthy)' in c or '(unhealthy)' not in c)
check(f"3b Container health ({len(containers)} running)", healthy >= 4)

# Step 4: Database seed
print("\n🌱 Step 4: Database initialized")
r = requests.post(f"{API}/auth/login", json={"identifier":"admin","password":"Wool"}, timeout=10)
admin_exists = r.status_code == 200 and r.json().get("ok")
check("4a Admin user exists + can login", admin_exists)

# Step 5: Access
print("\n🌐 Step 5: Access")
r = requests.get("http://localhost:3000/api/health", timeout=5)
check("5a Backend health", r.status_code == 200 and r.json().get("ok"))
r = requests.get("https://localhost/api/health", verify=False, timeout=5)
check("5b HTTPS works", r.status_code == 200)

# Step 6: Core features work
print("\n📁 Step 6: Core features")
TOKEN = requests.post(f"{API}/auth/login", json={"identifier":"admin","password":"Wool"}, timeout=10).json().get("data",{}).get("accessToken","")
if TOKEN:
    r = requests.post(f"{API}/files/folder", json={"name":f"deploy_{int(time.time())}","parentId":None,"private":False},
                       headers={"Authorization":f"Bearer {TOKEN}"}, timeout=10)
    check("6a Upload (create folder)", r.status_code in (200, 201, 409), f"HTTP {r.status_code}")
    check("6b Download (list files)",
          requests.get(f"{API}/files", headers={"Authorization":f"Bearer {TOKEN}"}, timeout=10).status_code == 200)
    check("6c Share (create link)",
          requests.post(f"{API}/shares", json={"nodeId": requests.get(f"{API}/files", headers={"Authorization":f"Bearer {TOKEN}"}, timeout=10).json().get("data",[{}])[0].get("id","")},
                       headers={"Authorization":f"Bearer {TOKEN}"}, timeout=10).status_code == 201)

# Step 7: Security defaults
print("\n🛡️ Step 7: Security defaults (North Star 0b)")
r = requests.get("http://localhost:3000/api/files", timeout=5)
check("7a Auth required (401)", r.status_code == 401)
check("7b HTTPS headers present",
      "strict-transport-security" in requests.get("https://localhost/api/health", verify=False, timeout=5).headers)

# Summary
print(f"\n{'='*60}")
passed = sum(1 for _, ok, _ in CHECKS if ok)
total = len(CHECKS)
icon = "✅" if passed == total else "⚠️"
print(f"{icon} Deploy verification: {passed}/{total} checks pass")
if passed < total:
    print("FAILS:")
    for step, ok, detail in CHECKS:
        if not ok: print(f"  ❌ {step}: {detail}")
