"""Verify admin test-email / test-sms / test-verify round-trip."""
import io
import sys
import requests
import urllib3

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE = "https://localhost/api"
ADMIN_USER = "admin"
ADMIN_PW = "1HeIDXEOCCrxsETa9M4yVk7g"
REDIS_PASS = "ek8fRnrqV6xDzEbrwsChqp9SMmNRRcELZ7oHXtBG"

PASS = 0
FAIL = 0

def check(label, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  PASS  {label}")
    else:
        FAIL += 1
        print(f"  FAIL  {label}  {detail}")


def post(path, body=None, token=None):
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    r = requests.post(f"{BASE}{path}", json=body or {}, headers=h, verify=False, timeout=15)
    try:
        j = r.json()
    except Exception:
        j = {"_text": r.text}
    return r.status_code, j


def get(path, token=None):
    h = {}
    if token:
        h["Authorization"] = f"Bearer {token}"
    r = requests.get(f"{BASE}{path}", headers=h, verify=False, timeout=15)
    try:
        j = r.json()
    except Exception:
        j = {"_text": r.text}
    return r.status_code, j


def main():
    print("── Admin test channels round-trip ──")

    sc, j = post("/auth/login", {"identifier": ADMIN_USER, "password": ADMIN_PW})
    data = j.get("data") or j
    token = data.get("accessToken")
    if not token:
        print(f"FAIL admin login: {sc} {j}")
        sys.exit(1)
    check("admin login", True)

    # 1. GET /admin/config should include sms field with provider=none default
    sc, j = get("/admin/config", token)
    cfg = j.get("data") or j
    check("GET /admin/config returns sms field", isinstance(cfg.get("sms"), dict),
          f"sms={cfg.get('sms')}")
    check("sms.provider defaults to 'none'", cfg.get("sms", {}).get("provider") == "none")
    check("sms has provider-agnostic fields",
          all(k in cfg.get("sms", {}) for k in ("accountSid", "authToken", "accessKeyId",
                                                  "accessKeySecret", "signName", "templateCode",
                                                  "region", "botToken", "from")))

    # 2. POST /admin/test-email — without SMTP configured the mail send falls
    #    through to dev log path (mail.service.ts L65-67). Code still stored in
    #    redis so verify can complete.
    sc, j = post("/admin/test-email", {"to": "ops@example.com"}, token)
    check("test-email accepts valid address", sc == 200, f"got {sc} {j}")

    # Read code directly from Redis to drive the verify step (since SMTP not
    # configured, no real email leaves the box — admin would normally read
    # the code from inbox, here we read from redis as proxy).
    import subprocess
    # Need the admin user's id. Look it up from the login response.
    admin_id = data.get("user", {}).get("id")
    r = subprocess.run(
        ["docker", "exec", "tgpan_redis", "redis-cli", "-a", REDIS_PASS,
         "get", f"admin:test-code:email:{admin_id}"],
        capture_output=True, timeout=5, check=False, text=True,
    )
    email_code = r.stdout.strip()
    check("redis stored test email code", bool(email_code and email_code.isdigit() and len(email_code) == 6),
          f"got {email_code!r}")

    sc, j = post("/admin/test-verify",
                 {"channel": "email", "code": email_code}, token)
    check("test-verify email succeeds with stored code", sc == 200, f"got {sc} {j}")

    # 3. test-sms — provider=none + dev mode returns devCode
    sc, j = post("/admin/test-sms", {"to": "+8613800000000"}, token)
    data = j.get("data") or j
    check("test-sms accepts valid phone", sc == 200, f"got {sc} {j}")
    dev_code = data.get("devCode")
    check("test-sms returns devCode (provider=none, dev mode)",
          bool(dev_code and len(dev_code) == 6), f"data={data}")

    sc, j = post("/admin/test-verify",
                 {"channel": "sms", "code": dev_code}, token)
    check("test-verify sms succeeds with dev code", sc == 200, f"got {sc} {j}")

    # 4. test-verify rejects wrong code
    sc, j = post("/admin/test-verify",
                 {"channel": "email", "code": "000000"}, token)
    check("test-verify rejects wrong code", sc == 400, f"got {sc} {j}")

    # 5. test-verify rejects non-6-digit
    sc, j = post("/admin/test-verify",
                 {"channel": "email", "code": "abc"}, token)
    check("test-verify rejects malformed code", sc == 400, f"got {sc} {j}")

    # 6. After successful verify, code is consumed → another verify fails
    sc, j = post("/admin/test-sms", {"to": "+8613800000000"}, token)
    data = j.get("data") or j
    code2 = data.get("devCode")
    if code2:
        sc, j = post("/admin/test-verify", {"channel": "sms", "code": code2}, token)
        check("re-send sms then verify works", sc == 200)
        sc, j = post("/admin/test-verify", {"channel": "sms", "code": code2}, token)
        check("verified code is one-shot (second verify rejected)", sc == 400)

    # 7. PATCH /admin/config with sms config persists
    sc, j = post("/auth/login", {"identifier": ADMIN_USER, "password": ADMIN_PW})
    fresh_token = (j.get("data") or j).get("accessToken")
    r = requests.patch(f"{BASE}/admin/config",
                       json={"sms": {"provider": "twilio", "accountSid": "ACtest123",
                                     "from": "+15005550006"},
                             "confirmPassword": ADMIN_PW},
                       headers={"Authorization": f"Bearer {fresh_token}",
                                "Content-Type": "application/json"},
                       verify=False, timeout=10)
    check("PATCH /admin/config with sms saved", r.status_code == 200,
          f"got {r.status_code} {r.text[:200]}")

    sc, j = get("/admin/config", fresh_token)
    cfg = j.get("data") or j
    check("sms.provider persisted as 'twilio'",
          cfg.get("sms", {}).get("provider") == "twilio",
          f"got {cfg.get('sms', {}).get('provider')}")
    check("sms.accountSid persisted",
          cfg.get("sms", {}).get("accountSid") == "ACtest123")
    check("sms.authToken masked on read",
          cfg.get("sms", {}).get("authToken") == "",
          f"got {cfg.get('sms', {}).get('authToken')!r}")

    print(f"\nPASS {PASS}  FAIL {FAIL}")
    sys.exit(0 if FAIL == 0 else 1)


if __name__ == "__main__":
    main()
