"""
A11 verify: bind-email dual-confirm 阻断 A8-bypass 接管攻击链.

Threat model:
  Attacker holds a stolen access token. Without A11 they can:
    1) POST /users/bind-email/send-code (attacker email) → 200
    2) POST /users/bind-email (attacker email + code) → email swapped
    3) POST /users/change-password/send-code → OTP to attacker inbox
    4) Change password → full takeover.

A11 inserts step 1.5: also need OTP from victim's CURRENT inbox.
Attacker can issue send-code-old, but cannot read the victim's mailbox →
the chain stops at step 2.

Coverage:
  1. Phone-only user (no bound email): first-time bind needs only new-side OTP.
  2. After first bind: user has bound email — subsequent change-email REJECTS
     without oldEmailCode.
  3. With wrong oldEmailCode → 400.
  4. With correct oldEmailCode + new code → 200, email swapped.
  5. send-code-old refuses when user has no bound email.
"""
import io
import os
import sys
import secrets
import subprocess
import time
import requests
import urllib3

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE = "https://localhost"
API = f"{BASE}/api"
REDIS_PASS = os.environ["REDIS_PASS"]
OK = (200, 201)

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


def redis_del(key):
    subprocess.run(["docker", "exec", "tgpan_redis", "redis-cli", "-a", REDIS_PASS, "del", key],
                   capture_output=True, timeout=5, check=False)


def clear_rate(target):
    """F1: rate key now includes purpose. Burn every purpose to be safe."""
    for purpose in ("register", "login", "reset_password",
                    "change_email", "change_phone", "change_password"):
        redis_del(f"vc:rate:{purpose}:{target}")


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


def random_cn_phone():
    return "138" + "".join(secrets.choice("0123456789") for _ in range(8))


def main():
    print("── A11 bind-email dual-confirm ──")

    # Setup: phone-only register + login
    phone = random_cn_phone()
    suffix = secrets.token_hex(3)
    username = f"a11{suffix}"
    pw = f"A11!{suffix}A1"

    sc, j = post("/verification/send", {"target": phone, "purpose": "register"})
    code = (j.get("data") or {}).get("code")
    sc, j = post("/auth/register",
                 {"username": username, "phone": phone, "code": code, "password": pw})
    sc, j = post("/auth/login", {"identifier": phone, "password": pw})
    access = (j.get("data") or j).get("accessToken")
    check("phone-only register+login", bool(access))

    # 1. send-code-old refuses when no bound email
    sc, j = post("/users/bind-email/send-code-old", {}, access)
    check("send-code-old refused (no bound email)", sc == 400, f"got {sc} {j}")
    check("error mentions 未绑定", "未绑定" in str(j), f"resp={j}")

    # 2. First-time bind — single-factor (no oldEmailCode)
    email1 = f"a11a_{secrets.token_hex(3)}@example.com"
    clear_rate(phone)
    sc, j = post("/users/bind-email/send-code", {"email": email1}, access)
    code1 = (j.get("data") or {}).get("code")
    check("first-bind send-code OK", bool(code1), f"resp={j}")
    sc, j = post("/users/bind-email", {"email": email1, "code": code1}, access)
    check("first-bind succeeds without oldEmailCode", sc in OK, f"got {sc} {j}")

    # Confirm bind reflected
    sc, j = get("/users/profile", access)
    prof = j.get("data") or j
    check("profile.email is email1", prof.get("email") == email1)

    # 3. Now changing email — must reject without oldEmailCode
    email2 = f"a11b_{secrets.token_hex(3)}@example.com"
    clear_rate(email1)
    sc, j = post("/users/bind-email/send-code", {"email": email2}, access)
    code2 = (j.get("data") or {}).get("code")
    check("change-email send new code OK", bool(code2), f"resp={j}")

    sc, j = post("/users/bind-email", {"email": email2, "code": code2}, access)
    check("change-email rejects without oldEmailCode 400", sc == 400, f"got {sc} {j}")
    check("error mentions 旧邮箱验证码", "旧邮箱验证码" in str(j), f"resp={j}")

    # 4. Wrong oldEmailCode also rejected
    sc, j = post("/users/bind-email",
                 {"email": email2, "code": code2, "oldEmailCode": "000000"}, access)
    check("change-email rejects wrong oldEmailCode", sc == 400, f"got {sc} {j}")

    # 5. Get a real old code + retry. New code was used above? Need re-send.
    clear_rate(email1)
    clear_rate(email2)
    sc, j = post("/users/bind-email/send-code-old", {}, access)
    old_code = (j.get("data") or {}).get("code")
    check("send-code-old after bind OK", bool(old_code), f"resp={j}")

    # The new-side code may have been consumed by the failed wrong-attempt path
    # (verify() locks on bad code but the original code itself isn't marked
    # used because it wasn't even reached). But to be safe, re-issue:
    sc, j = post("/users/bind-email/send-code", {"email": email2}, access)
    code2b = (j.get("data") or {}).get("code")
    check("re-send new code OK", bool(code2b), f"resp={j}")

    # 6. Both correct → success
    sc, j = post("/users/bind-email",
                 {"email": email2, "code": code2b, "oldEmailCode": old_code}, access)
    check("change-email dual-factor succeeds", sc in OK, f"got {sc} {j}")

    sc, j = get("/users/profile", access)
    prof = j.get("data") or j
    check("profile.email reflects new email2", prof.get("email") == email2)

    # 7. ATTACKER simulation: attacker has access but cannot read old inbox.
    #    Try to swap email1→attacker_email with new-side OTP only. Should fail.
    email3 = f"attacker_{secrets.token_hex(3)}@example.com"
    clear_rate(email2)
    sc, j = post("/users/bind-email/send-code", {"email": email3}, access)
    code3 = (j.get("data") or {}).get("code")
    sc, j = post("/users/bind-email", {"email": email3, "code": code3}, access)
    check("attack chain blocked: new-OTP only fails", sc == 400, f"got {sc} {j}")

    print(f"\nPASS {PASS}  FAIL {FAIL}")
    sys.exit(0 if FAIL == 0 else 1)


if __name__ == "__main__":
    main()
