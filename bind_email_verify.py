"""
Bind-email verify (A8 follow-up).

Coverage:
  1. Register phone-only user (no email).
  2. profile.email is null.
  3. change-password rejects/skips OTP depending on backend rule
     — for phone-only user current rule is "fallback to oldPassword".
  4. sendBindEmailCode → 200 (dev mode returns code).
  5. bindEmail with wrong code → 400.
  6. bindEmail with correct code → 200.
  7. profile.email reflects newly bound email.
  8. change-password now requires emailCode (A8 enforced).
  9. Duplicate-bind from another account rejects 409.
"""
import io
import os
import sys
import secrets
import subprocess
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
    # 138xxxxxxxx range — accepted by class-validator IsMobilePhone('zh-CN').
    return "138" + "".join(secrets.choice("0123456789") for _ in range(8))


def register_phone_user():
    phone = random_cn_phone()
    suffix = secrets.token_hex(3)
    username = f"be{suffix}"
    pw = f"Bind!{suffix}A1"

    sc, j = post("/verification/send", {"target": phone, "purpose": "register"})
    code = (j.get("data") or {}).get("code") or j.get("code")
    if not code:
        raise RuntimeError(f"phone OTP send failed: {sc} {j}")

    sc, j = post("/auth/register",
                 {"username": username, "phone": phone, "code": code, "password": pw})
    if sc not in OK:
        raise RuntimeError(f"phone register failed: {sc} {j}")

    sc, j = post("/auth/login", {"identifier": phone, "password": pw})
    if sc not in OK:
        raise RuntimeError(f"phone login failed: {sc} {j}")
    access = (j.get("data") or j).get("accessToken")
    for purpose in ("register", "login", "reset_password", "change_email", "change_phone", "change_password"):
        redis_del(f"vc:rate:{purpose}:{phone}")
    return phone, pw, access


def main():
    print("── Bind-email A8 follow-up ──")

    phone, pw, access = register_phone_user()
    check("phone-only register + login", bool(access))

    sc, j = get("/users/profile", access)
    prof = j.get("data") or j
    check("profile.email is null for phone-only user", prof.get("email") in (None, ""), f"prof.email={prof.get('email')!r}")

    # change-password before bind: no email → fallback path, no emailCode required
    sc, j = post("/users/change-password",
                 {"oldPassword": pw, "newPassword": pw + "X"}, access)
    check("pre-bind change-password works without OTP (fallback)", sc in OK, f"got {sc} {j}")
    # Re-login because change-password forces logout
    sc, j = post("/auth/login", {"identifier": phone, "password": pw + "X"})
    access = (j.get("data") or j).get("accessToken")
    check("re-login after pre-bind change-password", bool(access))

    new_email = f"be_{secrets.token_hex(3)}@example.com"

    # Wrong format rejected
    sc, j = post("/users/bind-email/send-code", {"email": "not-an-email"}, access)
    check("send bind-email rejects bad format", sc == 400, f"got {sc} {j}")

    # Send OTP
    sc, j = post("/users/bind-email/send-code", {"email": new_email}, access)
    check("send bind-email OTP OK", sc in OK, f"got {sc} {j}")
    bind_code = (j.get("data") or {}).get("code") or j.get("code")
    check("dev mode returns bind code", bool(bind_code))

    # Wrong code rejected
    sc, j = post("/users/bind-email",
                 {"email": new_email, "code": "000000"}, access)
    check("wrong code rejected 400", sc == 400, f"got {sc} {j}")

    # Correct binding
    sc, j = post("/users/bind-email",
                 {"email": new_email, "code": bind_code}, access)
    check("bind-email OK", sc in OK, f"got {sc} {j}")

    # Profile reflects new email
    sc, j = get("/users/profile", access)
    prof = j.get("data") or j
    check("profile.email reflects bound email", prof.get("email") == new_email, f"got {prof.get('email')!r}")

    # change-password now must require OTP (A8 enabled)
    sc, j = post("/users/change-password",
                 {"oldPassword": pw + "X", "newPassword": pw + "Y"}, access)
    check("post-bind change-password requires OTP", sc == 400, f"got {sc} {j}")
    check("error mentions 邮箱验证码", "邮箱验证码" in str(j), f"resp={j}")

    # Duplicate bind from another account rejected
    phone2, pw2, access2 = register_phone_user()
    sc, j = post("/users/bind-email/send-code", {"email": new_email}, access2)
    # Either pre-check 409 or rate-limit pass + atomic-write 409 — both acceptable.
    check("duplicate bind email rejected (409)", sc == 409, f"got {sc} {j}")

    # Replay of bind code rejected (already used)
    sc, j = post("/users/bind-email",
                 {"email": new_email, "code": bind_code}, access)
    check("bind code replay rejected", sc in (400, 409), f"got {sc} {j}")

    print(f"\nPASS {PASS}  FAIL {FAIL}")
    sys.exit(0 if FAIL == 0 else 1)


if __name__ == "__main__":
    main()
