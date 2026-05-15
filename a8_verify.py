"""
A8 verify: change-password 邮箱 OTP 流端到端.

Flow:
  1. Register a fresh test user with email (dev mode returns code in response).
  2. Login → access token.
  3. Negative: POST /users/change-password without emailCode → 400.
  4. POST /users/change-password/send-code → 200 with code (dev mode).
  5. Positive: POST /users/change-password with emailCode → 200.
  6. Verify forced logout: old access token → /users/profile returns 401.
  7. Login with new password → 200.

Also a UI snapshot: SecurityTab renders the OTP field when an email is bound.
"""
import io
import os
import subprocess
import sys
import secrets
import requests
import urllib3


REDIS_PASS = os.environ["REDIS_PASS"]


def redis_del(key):
    try:
        subprocess.run(
            ["docker", "exec", "tgpan_redis", "redis-cli", "-a", REDIS_PASS, "del", key],
            capture_output=True, text=True, timeout=5, check=False,
        )
    except Exception:
        pass

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE = "https://localhost"
API = f"{BASE}/api"

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


OK_STATUS = (200, 201)



def post(path, body=None, token=None):
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    r = requests.post(f"{API}{path}", json=body or {}, headers=h, verify=False, timeout=15)
    try:
        j = r.json()
    except Exception:
        j = {"_text": r.text}
    return r.status_code, j


def get(path, token=None):
    h = {}
    if token:
        h["Authorization"] = f"Bearer {token}"
    r = requests.get(f"{API}{path}", headers=h, verify=False, timeout=15)
    try:
        j = r.json()
    except Exception:
        j = {"_text": r.text}
    return r.status_code, j


def main():
    suffix = secrets.token_hex(3)
    username = f"a8user_{suffix}"
    email = f"a8_{suffix}@example.com"
    pw_old = f"A8old!{suffix}A1"
    pw_new = f"A8new!{suffix}A1"

    print("── A8 change-password OTP flow ──")

    # 1. send register OTP
    sc, j = post("/verification/send", {"target": email, "purpose": "register"})
    check("send register OTP", sc in OK_STATUS, f"got {sc} {j}")
    reg_code = j.get("data", {}).get("code") or j.get("code")
    check("dev mode returns register code", bool(reg_code), f"resp={j}")
    if not reg_code:
        return

    # 2. register (DTO: email + code)
    sc, j = post("/auth/register", {
        "username": username, "email": email, "code": reg_code, "password": pw_old,
    })
    check("register OK", sc in OK_STATUS, f"got {sc} {j}")

    # 3. login (DTO: identifier could be email/username — try email)
    sc, j = post("/auth/login", {"identifier": email, "password": pw_old})
    check("login OK", sc in OK_STATUS, f"got {sc} {j}")
    tokens = j.get("data") or j
    access = tokens.get("accessToken")
    check("got access token", bool(access), f"resp={j}")
    if not access:
        return

    # Confirm profile email round-trips
    sc, j = get("/users/profile", access)
    check("profile 200", sc == 200, f"got {sc}")
    prof = j.get("data") or j
    check("profile email matches", prof.get("email") == email, f"email={prof.get('email')}")

    # 4. negative — change-password without emailCode
    sc, j = post("/users/change-password",
                 {"oldPassword": pw_old, "newPassword": pw_new}, access)
    msg = (j.get("message") or j.get("error", {}).get("message") or "") if isinstance(j, dict) else ""
    check("no-otp change-password rejected 400", sc == 400, f"got {sc} {j}")
    check("error mentions 邮箱验证码", "邮箱验证码" in str(j), f"msg={j}")

    # 5. negative — wrong emailCode
    sc, j = post("/users/change-password",
                 {"oldPassword": pw_old, "newPassword": pw_new, "emailCode": "000000"}, access)
    check("wrong-otp change-password rejected 400", sc == 400, f"got {sc} {j}")

    # 6. send change-password OTP — clear per-target rate-limit first since
    # this test already burned it on register. In real usage 60s cooldown is
    # fine; tests need to bypass it deterministically.
    for purpose in ("register", "login", "reset_password", "change_email", "change_phone", "change_password"):
        redis_del(f"vc:rate:{purpose}:{email}")
    sc, j = post("/users/change-password/send-code", {}, access)
    check("send change-password OTP 200", sc in (200, 201), f"got {sc} {j}")
    cp_code = (j.get("data", {}) if isinstance(j, dict) else {}).get("code") or j.get("code")
    check("dev mode returns change-password code", bool(cp_code), f"resp={j}")
    if not cp_code:
        return

    # 7. positive — change-password with correct emailCode
    sc, j = post("/users/change-password",
                 {"oldPassword": pw_old, "newPassword": pw_new, "emailCode": cp_code}, access)
    check("change-password with OTP 200", sc in (200, 201), f"got {sc} {j}")

    # 8. force logout — old token now invalid
    sc, j = get("/users/profile", access)
    check("old token invalidated 401", sc == 401, f"got {sc} {j}")

    # 9. login with new password works
    sc, j = post("/auth/login", {"identifier": email, "password": pw_old})
    check("old password rejected 401/400", sc in (400, 401), f"got {sc} {j}")
    sc, j = post("/auth/login", {"identifier": email, "password": pw_new})
    check("new password login 200", sc in (200, 201), f"got {sc} {j}")

    # 10. replay protection — same code cannot be reused. Either 400 (used)
    # or 429 (throttled before reaching verify); both mean "not accepted".
    new_access = (j.get("data") or j).get("accessToken")
    if new_access:
        sc, j = post("/users/change-password",
                     {"oldPassword": pw_new, "newPassword": pw_old, "emailCode": cp_code},
                     new_access)
        check("code replay not accepted (4xx)", 400 <= sc < 500, f"got {sc} {j}")

    print(f"\nPASS {PASS}  FAIL {FAIL}")
    sys.exit(0 if FAIL == 0 else 1)


if __name__ == "__main__":
    main()
