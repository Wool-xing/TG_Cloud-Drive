"""
A12 verify: bind-phone dual-confirm (parallel to A11 bind-email).

Coverage mirrors a11_verify.py:
  1. Email-only register (no phone) → bind-phone first-time single-factor.
  2. send-code-old refused before bind.
  3. After first bind: change-phone requires oldPhoneCode.
  4. Wrong oldPhoneCode rejected.
  5. Correct dual-factor succeeds.
  6. Attacker-only-new-OTP path blocked.
"""
import io
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
REDIS_PASS = "ek8fRnrqV6xDzEbrwsChqp9SMmNRRcELZ7oHXtBG"
OK = (200, 201)
PURPOSES = ("register", "login", "reset_password",
            "change_email", "change_phone", "change_password")

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
    for purpose in PURPOSES:
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
    print("── A12 bind-phone dual-confirm ──")

    suffix = secrets.token_hex(3)
    email = f"a12_{suffix}@example.com"
    username = f"a12{suffix}"
    pw = f"A12!{suffix}A1"

    sc, j = post("/verification/send", {"target": email, "purpose": "register"})
    reg_code = (j.get("data") or {}).get("code")
    sc, j = post("/auth/register",
                 {"username": username, "email": email, "code": reg_code, "password": pw})
    check("email-only register", sc in OK, f"got {sc} {j}")
    sc, j = post("/auth/login", {"identifier": email, "password": pw})
    access = (j.get("data") or j).get("accessToken")
    check("login OK", bool(access))

    # 1. send-code-old refused when no bound phone
    sc, j = post("/users/bind-phone/send-code-old", {}, access)
    check("send-code-old refused (no bound phone)", sc == 400, f"got {sc} {j}")
    check("error mentions 未绑定", "未绑定" in str(j), f"resp={j}")

    # 2. First-bind phone — single-factor
    phone1 = random_cn_phone()
    sc, j = post("/users/bind-phone/send-code", {"phone": phone1}, access)
    code1 = (j.get("data") or {}).get("code")
    check("first-bind send-code OK", bool(code1), f"resp={j}")
    sc, j = post("/users/bind-phone", {"phone": phone1, "code": code1}, access)
    check("first-bind succeeds without oldPhoneCode", sc in OK, f"got {sc} {j}")

    sc, j = get("/users/profile", access)
    prof = j.get("data") or j
    check("profile.phone is phone1", prof.get("phone") == phone1, f"got {prof.get('phone')!r}")
    check("hasPhone=true after bind", prof.get("hasPhone") is True, f"got {prof.get('hasPhone')!r}")

    # 3. Change-phone — must require oldPhoneCode
    phone2 = random_cn_phone()
    clear_rate(phone1)
    sc, j = post("/users/bind-phone/send-code", {"phone": phone2}, access)
    code2 = (j.get("data") or {}).get("code")
    check("change-phone send new code OK", bool(code2), f"resp={j}")

    sc, j = post("/users/bind-phone", {"phone": phone2, "code": code2}, access)
    check("change-phone rejects without oldPhoneCode 400", sc == 400, f"got {sc} {j}")
    check("error mentions 旧手机号验证码", "旧手机号验证码" in str(j), f"resp={j}")

    # Wrong old code
    sc, j = post("/users/bind-phone",
                 {"phone": phone2, "code": code2, "oldPhoneCode": "000000"}, access)
    check("change-phone rejects wrong oldPhoneCode", sc == 400, f"got {sc} {j}")

    # 4. Get real old code + new code
    clear_rate(phone1)
    clear_rate(phone2)
    sc, j = post("/users/bind-phone/send-code-old", {}, access)
    old_code = (j.get("data") or {}).get("code")
    check("send-code-old after bind OK", bool(old_code), f"resp={j}")
    sc, j = post("/users/bind-phone/send-code", {"phone": phone2}, access)
    code2b = (j.get("data") or {}).get("code")
    check("re-send new code OK", bool(code2b))

    # 5. Both correct → success
    sc, j = post("/users/bind-phone",
                 {"phone": phone2, "code": code2b, "oldPhoneCode": old_code}, access)
    check("change-phone dual-factor succeeds", sc in OK, f"got {sc} {j}")

    sc, j = get("/users/profile", access)
    prof = j.get("data") or j
    check("profile.phone reflects new phone2", prof.get("phone") == phone2, f"got {prof.get('phone')!r}")

    # 6. Attacker simulation — new-OTP only fails
    phone3 = random_cn_phone()
    clear_rate(phone2)
    sc, j = post("/users/bind-phone/send-code", {"phone": phone3}, access)
    code3 = (j.get("data") or {}).get("code")
    sc, j = post("/users/bind-phone", {"phone": phone3, "code": code3}, access)
    check("attack chain blocked: new-OTP only fails", sc == 400, f"got {sc} {j}")

    print(f"\nPASS {PASS}  FAIL {FAIL}")
    sys.exit(0 if FAIL == 0 else 1)


if __name__ == "__main__":
    main()
