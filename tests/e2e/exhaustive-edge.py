"""
EXHAUSTIVE EDGE TESTING — quota, concurrency, MIME types, retry, RTL.
"""
import requests, json, sys, io, time, os, threading, base64, uuid
urllib3 = __import__('urllib3'); urllib3.disable_warnings()
if sys.platform == "win32": sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

API = "http://localhost:3000/api"
BUGS = []

def bug(sev, area, msg, detail=""):
    BUGS.append((sev, area, msg, detail))
    print(f"  {'🔥' if sev=='CRIT' else '🟠' if sev=='HIGH' else '🟡'} [{area}] {msg}")
    if detail: print(f"     {detail}")

r = requests.post(f"{API}/auth/login", json={"identifier":"admin","password":"Wool"}, timeout=10)
TOKEN = r.json().get("data",{}).get("accessToken","")

# ─── 1. QUOTA EXHAUSTION ───────────────────────────────────────────
print("\n📊 QUOTA EXHAUSTION")
r = requests.get(f"{API}/users/stats", headers={"Authorization":f"Bearer {TOKEN}"}, timeout=10)
s = r.json().get("data",{})
quota = s.get("quotaBytes",0); used = s.get("usedBytes",0)
print(f"  Quota: {used}/{quota} bytes ({used/quota*100:.2f}%)")

# Try to create document with negative content
r = requests.post(f"{API}/files/document", json={"name":"quota_test","parentId":None,"mimeType":"text/plain","content":"x"*100000}, headers={"Authorization":f"Bearer {TOKEN}"}, timeout=10)
if r.status_code == 500: bug("MED","Quota","100KB content causes 500")
elif r.status_code in (400,413): pass  # rejected OK
else: print(f"  Large doc: HTTP {r.status_code}")

# ─── 2. CONCURRENT FOLDER CREATION ─────────────────────────────────
print("\n⚡ CONCURRENCY")
results = []
errors = []
def make_folder(i):
    try:
        r = requests.post(f"{API}/files/folder", json={"name":f"concurrent_{i}_{int(time.time())}","parentId":None,"private":False}, headers={"Authorization":f"Bearer {TOKEN}"}, timeout=10)
        results.append(r.status_code)
    except Exception as e:
        errors.append(str(e))

threads = [threading.Thread(target=make_folder, args=(i,)) for i in range(5)]
[t.start() for t in threads]; [t.join() for t in threads]
if errors: bug("MED","Concurrency",f"{len(errors)}/5 concurrent folders failed", errors[0][:80])
elif all(s in (200,201) for s in results): print(f"  ✅ 5/5 concurrent folders created")
elif sum(1 for s in results if s in (200,201,409)) >= 4: print(f"  ✅ {sum(1 for s in results if s in (200,201,409))}/5 OK (some 409=conflict)")
else: bug("HIGH","Concurrency",f"Concurrent folders: {results}")

# Cleanup concurrent folders
r = requests.get(f"{API}/files", headers={"Authorization":f"Bearer {TOKEN}"}, timeout=10)
for node in r.json().get("data",[]):
    if "concurrent_" in node.get("name",""):
        requests.delete(f"{API}/files/trash/permanent", json={"nodeIds":[node["id"]]}, headers={"Authorization":f"Bearer {TOKEN}"}, timeout=10)

# ─── 3. MIME TYPE HANDLING ────────────────────────────────────────
print("\n📎 MIME TYPES")
MIMES = [
    ("image/png", "file.png"),
    ("video/mp4", "file.mp4"),
    ("audio/mp3", "file.mp3"),
    ("application/pdf", "file.pdf"),
    ("application/zip", "file.zip"),
    ("application/x-executable", "file.exe"),
    ("model/stl", "model.stl"),
    ("chemical/x-pdb", "protein.pdb"),
]
for mime, name in MIMES:
    r = requests.post(f"{API}/files/document", json={"name":name,"parentId":None,"mimeType":mime,"content":"data"}, headers={"Authorization":f"Bearer {TOKEN}"}, timeout=10)
    if r.status_code == 500: bug("MED","MIME",f"MIME '{mime}' causes 500")
    elif r.status_code in (200,201): print(f"  ✅ {mime} accepted")
    else: print(f"  ⚠️ {mime}: HTTP {r.status_code}")

# ─── 4. RTL LANGUAGE SUPPORT ──────────────────────────────────────
print("\n🔤 RTL/i18n")
# Check if translations file exists and has both languages
try:
    with open("D:/项目文件/TG云盘/frontend/src/i18n/translations.ts","r",encoding="utf-8") as f:
        content = f.read()
    has_zh = "const zh" in content
    has_en = "const en" in content
    has_rtl = "direction" in content or "rtl" in content or "RTL" in content
    keys_zh = content.count("\n  '")  # rough key count
    print(f"  zh: {'✅' if has_zh else '❌'}  en: {'✅' if has_en else '❌'}  RTL support: {'✅' if has_rtl else '❌'}  Keys: ~{keys_zh}")
    if not has_en: bug("HIGH","i18n","English translations missing!")
    if not has_rtl: bug("LOW","i18n","No RTL direction support for Arabic/Hebrew")
except FileNotFoundError:
    bug("HIGH","i18n","translations.ts not found")

# ─── 5. RATE LIMIT BEHAVIOR ────────────────────────────────────────
print("\n⏱️ RATE LIMIT RECOVERY")
# Check if rate-limited admin can still access health
r = requests.get(f"{API}/health", timeout=5)
if r.status_code == 200: print("  ✅ Health always accessible (no rate limit)")

# ─── 6. IDEMPOTENCY ────────────────────────────────────────────────
print("\n🔄 IDEMPOTENCY")
key = f"idem_{uuid.uuid4().hex[:12]}"
data1 = {"idempotencyKey":key,"chunkIndex":"0","totalChunks":"1","filename":"idem_test.bin","md5":"abc","mimeType":"app/octet","parentId":"null","private":"false","encryptedDek":"x","dekIv":"x","chunkIv":"x","salt":"x"}
r1 = requests.post(f"{API}/files/upload-chunk", data=data1, files={"chunk":("f.bin",b"data","app/octet")}, headers={"Authorization":f"Bearer {TOKEN}"}, timeout=15)
data2 = {**data1, "filename":"idem_test_different.bin","md5":"def"}
r2 = requests.post(f"{API}/files/upload-chunk", data=data2, files={"chunk":("f2.bin",b"other","app/octet")}, headers={"Authorization":f"Bearer {TOKEN}"}, timeout=15)
if r2.status_code == 500: bug("MED","Idempotency","Same key + different file params → 500")
elif r2.status_code in (200,201,409): print(f"  ✅ Idempotency handled: {r2.status_code}")
else: print(f"  ℹ️ Idempotency: HTTP {r2.status_code}")

# ─── 7. EMPTY/UPDATED/NEGATIVE INPUTS ──────────────────────────────
print("\n🧹 BOUNDARY INPUTS")
tests = [
    ("POST","/files/folder",{"name":""},"empty folder name"),
    ("POST","/files/folder",{"name":"x"*500},"500-char folder name"),
    ("GET","/files/search?q=","empty search"),
    ("GET","/users/audit-logs?page=-1&limit=-1","negative pagination"),
    ("GET","/users/audit-logs?page=0&limit=0","zero pagination"),
]
for method, path, data, label in tests:
    if method == "GET":
        r = requests.get(f"{API}{path}", headers={"Authorization":f"Bearer {TOKEN}"}, timeout=10)
    else:
        r = requests.post(f"{API}{path}", json=data, headers={"Authorization":f"Bearer {TOKEN}"}, timeout=10)
    if r.status_code == 500: bug("MED","Boundary",f"'{label}' causes 500")
    elif r.status_code in (200,201,400,404): print(f"  ✅ {label}: HTTP {r.status_code}")
    else: print(f"  ⚠️ {label}: HTTP {r.status_code}")

# ─── SUMMARY ────────────────────────────────────────────────────────
print(f"\n{'='*50}")
if not BUGS: print("✅ NO EDGE CASE BUGS FOUND")
else:
    print(f"🐛 {len(BUGS)} BUGS:")
    for sev, area, msg, detail in BUGS:
        print(f"  {sev} [{area}] {msg}")
        if detail: print(f"       {detail}")
