from flask import Flask, request, jsonify, render_template_string, redirect, session, send_file, make_response
import requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)  # 关闭SSL警告
import os
import json
import time
import bcrypt
import io
import random
from tenacity import retry, stop_after_attempt, wait_exponential, RetryError  # ✅ 修复：导入RetryError
import traceback  # ✅ 新增：导入堆栈打印模块
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

# ===================== 固定配置 =====================
app = Flask(__name__)
app.secret_key = "tg_pan_2026_secure_key_random123456_v2"
app.config['MAX_CONTENT_LENGTH'] = 214748364800  # 200GB 限制
CHUNK_SIZE = 20971520  # 20MB 分片
MAX_FOLDER_LEVEL = 5  # 最多5级目录
PAGE_SIZE = 20  # 每页显示20条

# --- 请替换为你的 Bot 信息 ---
BOT_TOKEN = "8662089336:AAGGYQEzeK--qLXfMSvgxUIMUxxsFLBfhNc"
CHAT_ID = "-1003891006734"

# ========== 多代理配置（禁用代理） ==========
# 代理列表：(代理地址, 是否需要HTTP代理)，按优先级排序
TG_PROXY_LIST = [
    ("https://api.telegram.org", False),    # 官方地址（禁用代理）
    ("https://api.telegram.dog", False),   # 备用1（第三方，无需代理）
    ("https://tg.i-c-a.su", False),        # 备用2（第三方，无需代理）
    ("https://telegram-api.pages.dev", False),  # 备用3（第三方，无需代理）
]
# 服务器端代理配置（禁用代理）
HTTP_PROXY_CONFIG = {}  # 清空代理配置
# 全局变量：缓存可用代理（避免重复测试）
_available_proxy = None
_proxy_expire_time = 0

# ========== 多代理自动切换核心函数 ==========
def get_available_tg_api():
    """测试所有代理地址，返回第一个可用的API地址+文件地址+代理配置"""
    global _available_proxy, _proxy_expire_time

    # 缓存未过期则直接返回（5分钟有效期）
    if _available_proxy and time.time() < _proxy_expire_time:
        return _available_proxy

    for api_proxy, need_http_proxy in TG_PROXY_LIST:
        # 拼接测试URL（使用getMe接口，轻量无副作用）
        test_url = f"{api_proxy}/bot{BOT_TOKEN}/getMe"
        # 选择是否使用HTTP代理
        proxies = HTTP_PROXY_CONFIG if need_http_proxy else {}

        try:
            # 测试连接（超时延长到10秒，适配VPN）
            response = requests.get(
                test_url,
                proxies=proxies,
                timeout=10,  # 原5秒→10秒，适配VPN延迟
                verify=False  # 忽略SSL证书错误（第三方代理可能有）
            )
            # 测试通过
            if response.status_code == 200 and response.json().get("ok"):
                print(f"✅ 可用代理：{api_proxy}")
                # 拼接最终URL
                tg_api_url = f"{api_proxy}/bot{BOT_TOKEN}"
                tg_file_url = f"{api_proxy}/file/bot{BOT_TOKEN}"
                # 缓存5分钟
                _available_proxy = (tg_api_url, tg_file_url, proxies)
                _proxy_expire_time = time.time() + 300  # 5分钟
                return _available_proxy
        except Exception as e:
            print(f"❌ 代理失效：{api_proxy}，错误：{str(e)[:50]}")
            continue

    # 所有代理都失效
    raise Exception("⚠️ 所有Telegram API代理均失效，请检查代理配置！")

# --- 验证码与安全配置 ---
BIND_PHONE = "13888888888"
MASTER_CODE = "888888"
RESEND_SECONDS = 60
sms_store = {
    "code": None,
    "phone": None,
    "send_time": 0
}

# ===================== 初始化 =====================
limiter = Limiter(get_remote_address, app=app)
os.makedirs("chunks", exist_ok=True)
os.makedirs("data", exist_ok=True)


# ===================== 全局禁用浏览器缓存 =====================
@app.after_request
def add_no_cache_header(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


# ===================== 安全工具 =====================
def hash_password(password):
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def check_password(password, hashed):
    return bcrypt.checkpw(password.encode(), hashed.encode())


# ===================== 文件操作（支持树形结构） =====================
def read_json(path, default=None):
    if default is None:
        default = []
    p = f"data/{path}"
    if not os.path.exists(p):
        return default
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return default


def write_json(path, data):
    p = f"data/{path}"
    with open(f"{p}.tmp", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(f"{p}.tmp", p)


# ===================== 文件夹工具函数 =====================
def get_item_by_id(items, item_id):
    for item in items:
        if item["id"] == item_id:
            return item
    return None


def get_parent_path(items, item_id):
    path = []
    current_id = item_id
    while current_id:
        item = get_item_by_id(items, current_id)
        if item:
            path.insert(0, item)
            current_id = item.get("parent_id")
        else:
            current_id = None
    return path


def get_children(items, parent_id):
    children = [item for item in items if item.get("parent_id") == parent_id]
    children.sort(key=lambda x: (0 if x["type"] == "folder" else 1, x["name"]))
    return children


def get_folder_level(items, folder_id):
    if not folder_id:
        return 0
    level = 0
    current_id = folder_id
    while current_id:
        item = get_item_by_id(items, current_id)
        if item and item["type"] == "folder":
            level += 1
            current_id = item.get("parent_id")
        else:
            break
    return level


def is_descendant(items, ancestor_id, descendant_id):
    if not ancestor_id:
        return False
    current_id = descendant_id
    while current_id:
        if current_id == ancestor_id:
            return True
        item = get_item_by_id(items, current_id)
        if item:
            current_id = item.get("parent_id")
        else:
            break
    return False


# ===================== 文件类型映射 =====================
FILE_MAP = {
    'image': '🖼️ 图片', 'video': '🎥 视频', 'audio': '🎵 音频', 'pdf': '📄 PDF',
    'word': '📘 Word', 'excel': '📊 Excel', 'zip': '🗜️ 压缩包', 'other': '📎 其他',
    'folder': '📁 文件夹'
}


def get_file_type(filename):
    ext = filename.split(".")[-1].lower() if "." in filename else ""
    if ext in ["jpg", "jpeg", "png", "gif"]: return "image", FILE_MAP["image"]
    if ext in ["mp4", "mov", "mkv"]: return "video", FILE_MAP["video"]
    if ext in ["mp3", "wav"]: return "audio", FILE_MAP["audio"]
    if ext == "pdf": return "pdf", FILE_MAP["pdf"]
    if ext in ["doc", "docx"]: return "word", FILE_MAP["word"]
    if ext in ["xls", "xlsx"]: return "excel", FILE_MAP["excel"]
    if ext in ["zip", "rar"]: return "zip", FILE_MAP["zip"]
    return "other", FILE_MAP["other"]


# ===================== TG 核心交互 =====================
@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10),
       reraise=True)  # ✅ 修复：添加reraise=True
def tg_upload(temp_path, name):
    # ========== 新增：获取可用代理 ==========
    try:
        TG_API_URL, TG_FILE_URL, proxies = get_available_tg_api()
    except Exception as e:
        raise Exception(f"获取可用TG代理失败：{str(e)}")

    # 手动识别 MIME 类型
    ext = name.split(".")[-1].lower() if "." in name else ""
    content_type = {
        "jpg": "image/jpeg", "jpeg": "image/jpeg",
        "png": "image/png",
        "mp4": "video/mp4", "mov": "video/quicktime", "mkv": "video/x-matroska",
        "mp3": "audio/mpeg",
        "pdf": "application/pdf",
        "doc": "application/msword", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls": "application/vnd.ms-excel", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "zip": "application/zip", "rar": "application/x-rar-compressed",
    }.get(ext, "application/octet-stream")

    time.sleep(random.uniform(0.5, 2))  # 防止被 Telegram 限流

    with open(temp_path, "rb") as f:
        files = {
            "document": (name, f, content_type)
        }
        try:
            # ✅ 修复：使用动态代理配置
            print(f"[TG UPLOAD] 开始上传文件：{name}，大小：{os.path.getsize(temp_path)} bytes")
            res = requests.post(
                f"{TG_API_URL}/sendDocument",
                data={"chat_id": CHAT_ID},
                files=files,
                proxies=proxies,  # 启用动态代理
                timeout=600,
                verify=False  # 忽略SSL证书错误（第三方代理可能需要）
            ).json()
            print(f"[TG UPLOAD] 返回结果：{res}")
        except Exception as e:
            raise Exception(f"TG API 请求异常：{str(e)}\n{traceback.format_exc()}")

    if not res.get("ok"):
        error_desc = res.get("description", "未知错误")
        raise Exception(f"Telegram 上传失败：{error_desc} (错误码：{res.get('error_code')})")
    return res["result"]["document"]["file_id"]

def get_file_stream(file_id):
    # ========== 新增：获取可用代理 ==========
    try:
        TG_API_URL, TG_FILE_URL, proxies = get_available_tg_api()
    except Exception as e:
        raise Exception(f"获取可用TG代理失败：{str(e)}")

    fp_res = requests.get(
        f"{TG_API_URL}/getFile?file_id={file_id}",
        proxies=proxies,  # 启用动态代理
        timeout=30,
        verify=False  # 忽略SSL证书错误
    ).json()
    if not fp_res.get("ok"): raise Exception("无法获取文件地址")
    file_url = f"{TG_FILE_URL}/{fp_res['result']['file_path']}"
    return requests.get(
        file_url,
        stream=True,
        proxies=proxies,  # 启用动态代理
        verify=False  # 忽略SSL证书错误
    )

# ===================== 登录校验 =====================
def login_required(f):
    def w(*args, **kwargs):
        if not session.get("user"): return redirect("/login")
        return f(*args, **kwargs)

    w.__name__ = f.__name__
    return w


def init_user():
    if not os.path.exists("data/user.json"):
        write_json("user.json", {
            "username": "admin",
            "password": hash_password("admin"),
            "phone": BIND_PHONE
        })
    return read_json("user.json")


# ===================== 路由：公开首页 =====================
@app.route("/")
def index():
    search_query = request.args.get("s", "").lower()
    parent_id = request.args.get("parent_id", "")
    page = int(request.args.get("page", 1))
    items = read_json("files.json", [])

    if search_query:
        all_items = [item for item in items if search_query in item["name"].lower()]
        breadcrumb = []
    else:
        all_items = get_children(items, parent_id)
        breadcrumb = get_parent_path(items, parent_id)

    total = len(all_items)
    total_pages = (total + PAGE_SIZE - 1) // PAGE_SIZE
    start = (page - 1) * PAGE_SIZE
    end = start + PAGE_SIZE
    display_items = all_items[start:end]

    cat = {}
    ORDER = ["folder", "image", "video", "audio", "pdf", "word", "excel", "zip", "other"]
    if not search_query:
        for item in display_items:
            t = item["type"]
            cat[t] = cat.get(t, []) + [item]

    return render_template_string('''
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>文件共享</title>
<link rel="stylesheet" href="https://cdn.bootcdn.net/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<style>
    html, body { margin: 0 !important; padding: 0 !important; top: 0 !important; position: static !important; }
    :root {
        --bg: #f0f2f5; --card: #fff; --text: #333; --text-sec: #888; --primary: #1677ff; --border: #eee;
        --btn-ghost-bg: transparent; --btn-ghost-border: var(--border); --btn-ghost-text: var(--text);
    }
    [data-theme="dark"] {
        --bg: #1a1a1a; --card: #2d2d2d; --text: #e5e5e5; --text-sec: #aaa; --primary: #4096ff; --border: #444;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .nav { background: var(--card); padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05); position: sticky; top: 0; z-index: 100; }
    .nav h1 { font-size: 20px; display: flex; align-items: center; gap: 10px; }
    .nav-right { display: flex; align-items: center; gap: 10px; }
    .container { max-width: 1000px; margin: 30px auto; padding: 0 20px; }
    .breadcrumb { background: var(--card); padding: 12px 20px; border-radius: 8px; margin-bottom: 20px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .breadcrumb a { color: var(--primary); text-decoration: none; }
    .search-box { display: flex; gap: 10px; margin-bottom: 20px; }
    .search-box input { flex: 1; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--card); color: var(--text); }
    .section { margin-bottom: 25px; background: var(--card); border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
    .sec-head { padding: 15px 20px; font-weight: 600; border-bottom: 1px solid var(--border); cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
    .sec-body { padding: 0 20px; }
    .file-item { display: flex; justify-content: space-between; align-items: center; padding: 15px 0; border-bottom: 1px solid var(--border); }
    .file-item:last-child { border-bottom: none; }
    .file-name { font-weight: 500; display: flex; align-items: center; gap: 10px; cursor: pointer; }
    .file-name:hover { color: var(--primary); }
    .file-info { font-size: 12px; color: var(--text-sec); margin-top: 4px; }
    .btn { padding: 8px 16px; border-radius: 6px; border: none; cursor: pointer; font-weight: 500; transition: all 0.2s ease; text-decoration: none; display: inline-flex; align-items: center; gap: 5px; }
    .btn-primary { background: var(--primary); color: white; }
    .btn-ghost { background: var(--btn-ghost-bg); border: 1px solid var(--btn-ghost-border); color: var(--btn-ghost-text); }
    .empty { text-align: center; padding: 50px; color: var(--text-sec); }
    .pagination { text-align: center; margin: 20px 0; display: flex; justify-content: center; gap: 10px; align-items: center; }
</style>
</head>
<body>
<div class="nav">
    <h1><i class="fa-solid fa-cloud"></i> 资源站</h1>
    <div class="nav-right">
        <button class="btn btn-ghost" onclick="toggleTheme()"><i class="fa-solid fa-moon"></i></button>
        <a href="/admin" class="btn btn-primary">管理后台</a>
    </div>
</div>
<div class="container">
    {% if not search_query %}
    <div class="breadcrumb">
        <i class="fa-solid fa-house"></i>
        <a href="/">根目录</a>
        {% for item in breadcrumb %}
        <span>/</span>
        {% if loop.last %}
        <span>{{item.name}}</span>
        {% else %}
        <a href="/?parent_id={{item.id}}">{{item.name}}</a>
        {% endif %}
        {% endfor %}
    </div>
    {% endif %}

    <div class="search-box">
        <input type="text" id="searchInput" placeholder="搜索文件..." value="{{search_query}}" autocomplete="off">
        <button class="btn btn-primary" onclick="doSearch()"><i class="fa-solid fa-search"></i> 搜索</button>
        {% if search_query %}
        <button class="btn btn-ghost" onclick="location.href='/'">返回目录</button>
        {% endif %}
    </div>

    {% if search_query %}
        {% if not display_items %}
        <div class="section"><div class="empty">未找到包含 "{{search_query}}" 的文件。</div></div>
        {% else %}
        <div class="section">
            <div class="sec-head">搜索结果 ({{display_items|length}})</div>
            <div class="sec-body">
                {% for item in display_items %}
                <div class="file-item">
                    <div>
                        <div class="file-name">{{FILE_MAP[item.type].split(' ')[0]}} {{item.name}}</div>
                        <div class="file-info">{{item.time}}</div>
                    </div>
                    <div style="display:flex; gap:10px;">
                        <button class="btn btn-ghost" onclick="copyOne('{{item.id}}')">复制链接</button>
                        <a href="/download/{{item.id}}" class="btn btn-primary">下载</a>
                    </div>
                </div>
                {% endfor %}
            </div>
        </div>
        {% endif %}
    {% else %}
        {% if not cat %}
        <div class="section"><div class="empty">当前目录为空，请登录后台上传文件或创建文件夹。</div></div>
        {% endif %}
        {% for c in ORDER if c in cat %}
        <div class="section">
            <div class="sec-head" onclick="toggle('{{c}}')">
                <span>{{FILE_MAP[c]}} ({{cat[c]|length}})</span>
                <i class="fa-solid fa-chevron-down"></i>
            </div>
            <div class="sec-body" id="box-{{c}}">
                {% for item in cat[c] %}
                <div class="file-item">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div>
                            {% if item.type == 'folder' %}
                            <div class="file-name" onclick="location.href='/?parent_id={{item.id}}'">
                                <i class="fa-solid fa-folder" style="color: #ffc107;"></i> {{item.name}}
                            </div>
                            {% else %}
                            <div class="file-name">{{FILE_MAP[item.type].split(' ')[0]}} {{item.name}}</div>
                            {% endif %}
                            <div class="file-info">{{item.time}}</div>
                        </div>
                    </div>
                    <div style="display:flex; gap:10px;">
                        {% if item.type != 'folder' %}
                        <button class="btn btn-ghost" onclick="copyOne('{{item.id}}')">复制链接</button>
                        <a href="/download/{{item.id}}" class="btn btn-primary">下载</a>
                        {% else %}
                        <a href="/?parent_id={{item.id}}" class="btn btn-primary">进入</a>
                        {% endif %}
                    </div>
                </div>
                {% endfor %}
            </div>
        </div>
        {% endfor %}
    {% endif %}

    {% if total_pages > 1 %}
    <div class="pagination">
        {% if page > 1 %}
        <a href="?{{ 's='+search_query+'&' if search_query else '' }}parent_id={{parent_id}}&page={{page-1}}" class="btn btn-ghost">上一页</a>
        {% endif %}
        <span>第 {{ page }} 页 / 共 {{ total_pages }} 页</span>
        {% if page < total_pages %}
        <a href="?{{ 's='+search_query+'&' if search_query else '' }}parent_id={{parent_id}}&page={{page+1}}" class="btn btn-ghost">下一页</a>
        {% endif %}
    </div>
    {% endif %}
</div>
<script>
document.addEventListener('DOMContentLoaded', function() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
});
function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
}
const debounce=(f,d=200)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>f.apply(this,a),d)}}
function doSearch(){ const v = document.getElementById('searchInput').value; window.location.href = '/?s=' + encodeURIComponent(v); }
document.getElementById('searchInput').addEventListener('input', debounce(doSearch));
function toggle(id){ const e = document.getElementById('box-'+id); e.style.display = e.style.display === 'none' ? 'block' : 'none'; }
async function copyOne(id){ 
    const url = window.location.origin + "/download/" + id; 
    try { await navigator.clipboard.writeText(url); alert("链接已复制"); } catch { alert("复制失败"); }
}
</script>
</body>
</html>
''', cat=cat, FILE_MAP=FILE_MAP, ORDER=ORDER, search_query=search_query,
                                  display_items=display_items, breadcrumb=breadcrumb,
                                  parent_id=parent_id, page=page, total_pages=total_pages)


# ===================== 路由：代理下载 =====================
@app.route("/download/<file_id>")
def download(file_id):
    items = read_json("files.json", [])
    item = get_item_by_id(items, file_id)
    if not item or item["type"] == "folder": return "文件未找到", 404
    try:
        tg_resp = get_file_stream(item['file_id'])
        return send_file(
            io.BytesIO(tg_resp.content),
            as_attachment=False,
            download_name=item['name'],
            mimetype=tg_resp.headers.get('Content-Type', 'application/octet-stream')
        )
    except Exception as e:
        return f"获取文件失败: {str(e)}", 500


# ===================== 路由：管理后台 =====================
@app.route("/admin")
@login_required
def admin_index():
    parent_id = request.args.get("parent_id", "")
    page = int(request.args.get("page", 1))
    items = read_json("files.json", [])

    all_display_items = get_children(items, parent_id)
    total = len(all_display_items)
    total_pages = (total + PAGE_SIZE - 1) // PAGE_SIZE
    start = (page - 1) * PAGE_SIZE
    end = start + PAGE_SIZE
    display_items = all_display_items[start:end]

    breadcrumb = get_parent_path(items, parent_id)
    current_level = get_folder_level(items, parent_id)
    can_create_folder = current_level < MAX_FOLDER_LEVEL

    return render_template_string('''
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>管理后台</title>
<link rel="stylesheet" href="https://cdn.bootcdn.net/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<style>
    html, body { margin: 0 !important; padding: 0 !important; top: 0 !important; position: static !important; }
    :root {
        --bg: #f0f2f5; --card: #fff; --text: #333; --text-sec: #888; --primary: #1677ff; --border: #eee;
        --table-header-bg: #fafafa; --btn-ghost-bg: #f0f0f0; --btn-ghost-text: #333; --btn-danger: #ff4d4f;
        --upload-border: #ddd; --upload-hover-bg: #f6ffed; --upload-hover-border: #1677ff; --modal-overlay: rgba(0,0,0,0.5);
    }
    [data-theme="dark"] {
        --bg: #1a1a1a; --card: #2d2d2d; --text: #e5e5e5; --text-sec: #aaa; --primary: #4096ff; --border: #444;
        --table-header-bg: #262626; --btn-ghost-bg: #3a3a3a; --btn-ghost-text: #e5e5e5; --btn-danger: #ff7875;
        --upload-border: #555; --upload-hover-bg: #2a3a2a; --upload-hover-border: #4096ff; --modal-overlay: rgba(0,0,0,0.7);
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', sans-serif; }
    .nav { background: var(--card); padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
    .nav h3 { display: flex; align-items: center; gap: 8px; }
    .nav-right { display: flex; align-items: center; gap: 10px; }
    .container { max-width: 1400px; margin: 20px auto; padding: 0 15px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    @media (max-width: 900px) { .container { grid-template-columns: 1fr; } }
    .card { background: var(--card); border-radius: 10px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
    .card h4 { margin-bottom: 15px; display: flex; align-items: center; gap: 8px; }
    .btn { padding: 10px 15px; border-radius: 6px; border: none; cursor: pointer; font-weight: 500; transition: all 0.2s ease; text-decoration: none; display: inline-flex; align-items: center; gap: 5px; font-size: 14px;}
    .btn-primary { background: var(--primary); color: white; }
    .btn-danger { background: var(--btn-danger); color: white; }
    .btn-ghost { background: var(--btn-ghost-bg); color: var(--btn-ghost-text); }
    .btn-sm { padding: 6px 8px; font-size: 12px; flex-shrink: 0; }
    .btn:hover { opacity: 0.9; }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }

    .breadcrumb { background: var(--card); padding: 12px 20px; border-radius: 8px; margin-bottom: 20px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; grid-column: 1 / -1; }
    .breadcrumb a { color: var(--primary); }
    .upload-zone { border: 2px dashed var(--upload-border); border-radius: 8px; padding: 30px; text-align: center; cursor: pointer; }
    .upload-zone:hover { border-color: var(--upload-hover-border); background: var(--upload-hover-bg); }
    .queue-list { max-height: 300px; overflow-y: auto; margin-top: 15px; }
    .queue-item { display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid var(--border); }
    .q-progress { width: 100%; height: 4px; background: var(--border); border-radius: 2px; margin-top: 5px; }
    .q-bar { height: 100%; background: var(--primary); width: 0%; }

    .file-list-container { grid-column: 1 / -1; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    .table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .table th, .table td { padding: 12px; text-align: left; border-bottom: 1px solid var(--border); }
    .table th { background: var(--table-header-bg); }
    .table-body-container { max-height: 500px; overflow-y: auto; }
    .tools { display: flex; gap: 10px; margin-bottom: 15px; flex-wrap: wrap; padding: 0 20px; }
    .tools input { flex: 1; min-width: 200px; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--card); color: var(--text); }
    .empty-row { text-align:center; padding:30px; color:var(--text-sec); }
    .folder-name { cursor: pointer; display: flex; align-items: center; gap: 8px; }
    .folder-name:hover { color: var(--primary); }
    .btn-group { display: flex; gap: 4px; flex-wrap: nowrap; width: max-content; }
    .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: var(--modal-overlay); display: none; justify-content: center; align-items: center; z-index: 1000; }
    .modal-overlay.active { display: flex; }
    .modal { background: var(--card); padding: 25px; border-radius: 12px; min-width: 350px; max-width: 500px; width: 90%; }
    .modal h3 { margin-bottom: 20px; }
    .modal input, .modal select { width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--card); color: var(--text); margin-bottom: 15px; }
    .modal-footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px; }

    .pagination { text-align: center; margin: 20px 0; display: flex; justify-content: center; gap: 10px; align-items: center; grid-column: 1 / -1; }
</style>
</head>
<body>

<div class="nav">
    <h3><i class="fa-solid fa-server"></i> TG-云</h3>
    <div class="nav-right">
        <button class="btn btn-ghost" onclick="toggleTheme()"><i class="fa-solid fa-moon"></i></button>
        <a href="/change_password" class="btn btn-ghost">修改密码</a>
        <a href="/" class="btn btn-ghost">返回首页</a>
        <a href="/logout" class="btn btn-danger">退出</a>
    </div>
</div>

<div class="container">
    <div class="breadcrumb">
        <i class="fa-solid fa-house"></i>
        <a href="/admin">根目录</a>
        {% for item in breadcrumb %}
        <span>/</span>
        {% if loop.last %}
        <span>{{item.name}}</span>
        {% else %}
        <a href="/admin?parent_id={{item.id}}">{{item.name}}</a>
        {% endif %}
        {% endfor %}
    </div>

    <div class="card">
        <h4><i class="fa-solid fa-upload"></i> 上传队列</h4>
        <div class="upload-zone" onclick="document.getElementById('fileInput').click()">
            <i class="fa-solid fa-cloud-arrow-up" style="font-size: 40px; color: var(--primary);"></i>
            <p style="margin-top: 10px; color: var(--text-sec);">点击或拖拽文件上传</p>
            <input type="file" id="fileInput" multiple style="display:none;">
        </div>
        <div class="queue-list" id="queueList"></div>
        <div style="margin-top: 15px; display:flex; gap:10px;">
            <button class="btn btn-primary" id="startBtn" onclick="startQueue()">开始上传</button>
            <button class="btn btn-ghost" onclick="clearQueue()">清空列表</button>
        </div>
    </div>

    <div class="card">
        <h4><i class="fa-solid fa-chart-line"></i> 系统状态</h4>
        <p>当前目录层级: {{current_level}} / {{MAX_FOLDER_LEVEL}}</p>
        <p>当前目录项数: {{total}} (共 {{total_pages}} 页)</p>
    </div>

    <div class="card file-list-container">
        <div style="padding: 20px 0 0 0;">
            <div class="tools">
                <input type="text" id="adminSearch" placeholder="搜索文件..." autocomplete="off">
                {% if can_create_folder %}
                <button class="btn btn-primary" onclick="openCreateFolderModal()"><i class="fa-solid fa-folder-plus"></i> 新建文件夹</button>
                {% endif %}
                <button class="btn btn-danger" onclick="batchDeleteAdmin()">批量删除</button>
                <button class="btn btn-ghost" onclick="location.reload()">刷新</button>
            </div>
        </div>

        <div class="table-header-container">
            <table class="table">
                <col width="40"><col><col width="100"><col width="150"><col width="380">
                <tr><th><input type="checkbox" id="checkAll" onclick="toggleAllCheck()"></th><th>名称</th><th>类型</th><th>时间</th><th>操作</th></tr>
            </table>
        </div>

        <div class="table-body-container">
            <table class="table">
                <col width="40"><col><col width="100"><col width="150"><col width="380">
                <tbody id="adminFileTbody">
                    {% for item in display_items %}
                    <tr class="file-row" data-filename="{{item.name|lower}}" data-id="{{item.id}}">
                        <td><input type="checkbox" class="admin-check" value="{{item.id}}"></td>
                        <td>
                            {% if item.type == 'folder' %}
                            <div class="folder-name" onclick="location.href='/admin?parent_id={{item.id}}'">
                                <i class="fa-solid fa-folder" style="color: #ffc107;"></i> {{item.name}}
                            </div>
                            {% else %}{{item.name}}{% endif %}
                        </td>
                        <td>{{item.label if item.type != 'folder' else '文件夹'}}</td>
                        <td>{{item.time}}</td>
                        <td>
                            <div class="btn-group">
                                {% if item.type == 'folder' %}
                                <button class="btn btn-ghost btn-sm" onclick="location.href='/admin?parent_id={{item.id}}'">进入</button>
                                <button class="btn btn-primary btn-sm" onclick="openRenameModal('{{item.id}}', '{{item.name}}')">重命名</button>
                                <button class="btn btn-primary btn-sm" onclick="openMoveModal('{{item.id}}', 'folder')">移动</button>
                                <button class="btn btn-danger btn-sm" onclick="delOneAdmin('{{item.id}}', 'folder')">删除</button>
                                {% else %}
                                <button class="btn btn-ghost btn-sm" onclick="copyOneAdmin('{{item.id}}')">复制</button>
                                <button class="btn btn-primary btn-sm" onclick="openRenameModal('{{item.id}}', '{{item.name}}')">重命名</button>
                                <button class="btn btn-primary btn-sm" onclick="openMoveModal('{{item.id}}', 'file')">移动</button>
                                <a href="/download/{{item.id}}" class="btn btn-ghost btn-sm" target="_blank">下载</a>
                                <button class="btn btn-danger btn-sm" onclick="delOneAdmin('{{item.id}}', 'file')">删除</button>
                                {% endif %}
                            </div>
                        </td>
                    </tr>
                    {% endfor %}
                    {% if not display_items %}
                    <tr class="empty-row"><td colspan="5">当前目录为空</td></tr>
                    {% endif %}
                </tbody>
            </table>
        </div>
    </div>

    {% if total_pages > 1 %}
    <div class="pagination">
        {% if page > 1 %}
        <a href="/admin?parent_id={{parent_id}}&page={{page-1}}" class="btn btn-ghost">上一页</a>
        {% endif %}
        <span>第 {{ page }} 页 / 共 {{ total_pages }} 页</span>
        {% if page < total_pages %}
        <a href="/admin?parent_id={{parent_id}}&page={{page+1}}" class="btn btn-ghost">下一页</a>
        {% endif %}
    </div>
    {% endif %}
</div>

<div class="modal-overlay" id="createFolderModal">
    <div class="modal">
        <h3>新建文件夹</h3>
        <input type="text" id="folderNameInput" placeholder="文件夹名称" autocomplete="off">
        <div class="modal-footer">
            <button class="btn btn-ghost" onclick="closeCreateFolderModal()">取消</button>
            <button class="btn btn-primary" onclick="createFolder()">确定</button>
        </div>
    </div>
</div>
<div class="modal-overlay" id="moveModal">
    <div class="modal">
        <h3>移动到</h3>
        <select id="moveTargetSelect"><option value="">根目录</option></select>
        <input type="hidden" id="moveItemId">
        <div class="modal-footer">
            <button class="btn btn-ghost" onclick="closeMoveModal()">取消</button>
            <button class="btn btn-primary" onclick="moveItem()">确定</button>
        </div>
    </div>
</div>
<div class="modal-overlay" id="renameModal">
    <div class="modal">
        <h3>重命名</h3>
        <input type="text" id="renameNameInput" placeholder="新名称">
        <input type="hidden" id="renameItemId">
        <div class="modal-footer">
            <button class="btn btn-ghost" onclick="closeRenameModal()">取消</button>
            <button class="btn btn-primary" onclick="saveRename()">确定</button>
        </div>
    </div>
</div>

<script>
const CHUNK_SIZE = {{CHUNK_SIZE}};
const CURRENT_PARENT_ID = "{{parent_id}}";
let uploadQueue = [];
let isUploading = false;

document.addEventListener('DOMContentLoaded', function() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
});

function toggleTheme() {
    const t = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('theme', t);
}

async function copyToClipboard(t){ try{await navigator.clipboard.writeText(t)}catch{const e=document.createElement('textarea');e.value=t;document.body.appendChild(e);e.select();document.execCommand('copy');document.body.removeChild(e)}}

function filterAdminFiles(k){const v=k.toLowerCase().trim();document.querySelectorAll('.file-row').forEach(r=>r.hidden=!r.dataset.filename.includes(v))}
const debounce=(f,d=200)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>f.apply(this,a),d)}}
document.getElementById('adminSearch').addEventListener('input',debounce(e=>filterAdminFiles(e.target.value)));

document.getElementById('fileInput').addEventListener('change',e=>{for(let f of e.target.files)uploadQueue.push({file:f,id:Math.random().toString(16).slice(2)+Date.now(),progress:0,status:'waiting'});renderQueue();e.target.value=''});

function renderQueue(){
  document.getElementById('queueList').innerHTML = uploadQueue.map((i, idx) => `
  <div class="queue-item" data-idx="${idx}">
    <div>
      <div>${i.file.name} 
        <span style="color:${i.status==='success'?'#52c41a':i.status==='error'?'#ff4d4f':'#888'}">${i.status==='waiting'?'等待中':i.status==='uploading'?'上传中':i.status==='success'?'上传成功':'上传失败'}</span>
        <span class="progress-pct" style="margin-left:8px; font-weight:bold;">${i.progress}%</span>
      </div>
      <div class="q-progress"><div class="q-bar" style="width:${i.progress}%"></div></div>
    </div>
    <button class="btn btn-ghost btn-sm" onclick="removeFromQueue(${idx})" ${i.status==='uploading'?'disabled':''}>移除</button>
  </div>`).join('')
}
function removeFromQueue(i){if(uploadQueue[i].status!=='uploading'){uploadQueue.splice(i,1);renderQueue()}}
function clearQueue(){if(!isUploading){uploadQueue=[];renderQueue()}}

// ✅ 修复核心：startQueue 函数
async function startQueue(){
    if(uploadQueue.length===0 || isUploading) return;
    isUploading = true;
    const startBtn = document.getElementById('startBtn');
    startBtn.disabled = true;
    startBtn.innerText = "上传中...";

    let successCount = 0;
    let failCount = 0;
    let failMessages = [];

    for(let i=0; i<uploadQueue.length; i++){
        if(uploadQueue[i].status === 'success') {
            successCount++;
            continue;
        }
        uploadQueue[i].status = 'uploading';
        renderQueue();
        try {
            await uploadFile(uploadQueue[i], p => {
                uploadQueue[i].progress = p;
                renderQueue();
            });
            uploadQueue[i].status = 'success';
            uploadQueue[i].progress = 100;
            successCount++;
        } catch (e) {
            console.error("上传失败:", e);
            uploadQueue[i].status = 'error';
            failCount++;
            failMessages.push(`${uploadQueue[i].file.name}: ${e.message}`);
        }
        renderQueue();
    }

    isUploading = false;
    startBtn.disabled = false;
    startBtn.innerText = "开始上传";

    // ✅ 关键修复：根据上传结果提示不同信息
    await refreshFileList();
    if(failCount > 0) {
        alert(`上传完成！成功：${successCount}个，失败：${failCount}个\n失败详情：\n${failMessages.join('\\n')}`);
    } else {
        alert(`所有${successCount}个文件上传完成！`);
    }
}

// ✅ 新增：AJAX 刷新列表函数
async function refreshFileList() {
    try {
        const response = await fetch(window.location.href);
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const newTbody = doc.querySelector('#adminFileTbody');
        const oldTbody = document.querySelector('#adminFileTbody');

        if(newTbody && oldTbody) {
            oldTbody.innerHTML = newTbody.innerHTML;
        }
    } catch (e) {
        console.error("刷新列表失败", e);
    }
}

async function uploadFile(item, pb) {
  const f = item.file;
  const total = Math.ceil(f.size / CHUNK_SIZE);
  const idx = uploadQueue.indexOf(item);
  const pctEl = document.querySelector(`.queue-item[data-idx="${idx}"] .progress-pct`);

  for (let i = 0; i < total; i++) {
    const b = f.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const fd = new FormData();
    fd.append('file', b);
    fd.append('fid', item.id);
    fd.append('idx', i);

    const res = await fetch('/api/chunk', { method: 'POST', body: fd });
    if(!res.ok) throw new Error("分片上传失败");

    const progress = Math.round((i / total) * 90);
    pb(progress);
    if(pctEl) pctEl.textContent = progress + '%';
  }

  pb(95);
  if(pctEl) pctEl.textContent = '95%';

  const r = await fetch('/api/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fid: item.id, name: f.name, total, parent_id: CURRENT_PARENT_ID })
  });

  const res = await r.json();
  if (!res.ok) throw new Error(res.msg || "合并失败");

  pb(100);
  if(pctEl) pctEl.textContent = '100%';
}

async function copyOneAdmin(id){await copyToClipboard(window.location.origin+"/download/"+id);alert("已复制")}
async function delOneAdmin(id,t){if(!confirm(t==='folder'?'删除文件夹？':'删除文件？'))return;await fetch('/delete/'+id,{method:'POST'});location.reload()}
function toggleAllCheck(){const c=document.getElementById('checkAll').checked;document.querySelectorAll('.admin-check').forEach(i=>i.checked=c)}
async function batchDeleteAdmin(){const ids=Array.from(document.querySelectorAll('.admin-check:checked')).map(i=>i.value);if(ids.length===0||!confirm(`删除${ids.length}项？`))return;await fetch('/batch_delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})});location.reload()}

function openCreateFolderModal(){document.getElementById('createFolderModal').classList.add('active')}
function closeCreateFolderModal(){document.getElementById('createFolderModal').classList.remove('active');document.getElementById('folderNameInput').value = '';}
async function createFolder(){const n=document.getElementById('folderNameInput').value.trim();if(!n)return;const r=await fetch('/api/create_folder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n,parent_id:CURRENT_PARENT_ID})});const res=await r.json();res.ok?(closeCreateFolderModal(),location.reload()):alert(res.msg)}

async function openMoveModal(id){document.getElementById('moveItemId').value=id;const r=await fetch('/api/get_move_folders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({exclude_id:id})});const res=await r.json();if(!res.ok)return;const s=document.getElementById('moveTargetSelect');s.innerHTML='<option value="">根目录</option>';res.folders.forEach(f=>{const o=document.createElement('option');o.value=f.id;o.textContent='　'.repeat(f.level)+(f.level?'└ ':'')+f.name;s.appendChild(o)});document.getElementById('moveModal').classList.add('active')}
function closeMoveModal(){document.getElementById('moveModal').classList.remove('active')}
async function moveItem(){const id=document.getElementById('moveItemId').value;const t=document.getElementById('moveTargetSelect').value;const r=await fetch('/api/move_item',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({item_id:id,target_parent_id:t})});const res=await r.json();res.ok?(closeMoveModal(),location.reload()):alert(res.msg)}

function openRenameModal(id,name){document.getElementById('renameItemId').value=id;document.getElementById('renameNameInput').value=name;document.getElementById('renameModal').classList.add('active')}
function closeRenameModal(){document.getElementById('renameModal').classList.remove('active')}
async function saveRename(){const id=document.getElementById('renameItemId').value;const n=document.getElementById('renameNameInput').value.trim();if(!n)return;const r=await fetch('/api/rename_item',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({item_id:id,new_name:n})});const res=await r.json();res.ok?(closeRenameModal(),location.reload()):alert(res.msg)}
</script>
</body>
</html>
''', items=items, display_items=display_items, breadcrumb=breadcrumb,
                                  parent_id=parent_id, current_level=current_level, can_create_folder=can_create_folder,
                                  MAX_FOLDER_LEVEL=MAX_FOLDER_LEVEL, CHUNK_SIZE=CHUNK_SIZE,
                                  page=page, total_pages=total_pages, total=total)


# ===================== 登录/退出/修改密码 =====================
@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        u, p = request.form["username"], request.form["password"]
        user = init_user()
        if u == user["username"] and check_password(p, user["password"]):
            session["user"] = u
            return redirect("/admin")
        return "<script>alert('账号或密码错误');location.href='/login'</script>"
    return render_template_string('''
<div style="max-width:350px;margin:100px auto;background:#fff;padding:30px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1)">
    <h2 style="text-align:center">🔐 登录</h2>
    <form method="post" style="margin-top:20px">
        <input name="username" placeholder="账号" autocomplete="off" style="width:100%;padding:12px;margin:10px 0;border-radius:8px;border:1px solid #ddd">
        <input name="password" type="password" placeholder="密码" autocomplete="new-password" style="width:100%;padding:12px;margin:10px 0;border-radius:8px;border:1px solid #ddd">
        <button style="width:100%;padding:12px;background:#1677ff;color:white;border:none;border-radius:8px;cursor:pointer">登录</button>
    </form>
</div>
''')


@app.route("/logout")
def logout():
    session.clear()
    return redirect("/login")


@app.route("/change_password", methods=["GET", "POST"])
@login_required
def change_password():
    user = init_user()
    if request.method == "POST":
        input_phone = request.form.get("phone", "").strip()
        input_code = request.form.get("code", "").strip()
        old_p = request.form.get("old_password", "").strip()
        new_p = request.form.get("new_password", "").strip()

        if not input_phone: return "<script>alert('请输入手机号');location.href='/change_password'</script>"
        if not input_code: return "<script>alert('请输入验证码');location.href='/change_password'</script>"
        if not old_p: return "<script>alert('请输入旧密码');location.href='/change_password'</script>"
        if not new_p: return "<script>alert('请输入新密码');location.href='/change_password'</script>"

        if input_phone != BIND_PHONE:
            return "<script>alert('手机号不正确，无法修改密码');location.href='/change_password'</script>"

        code_valid = False
        if input_code == MASTER_CODE:
            code_valid = True
        else:
            if (sms_store["code"] and sms_store["phone"] == input_phone and sms_store["code"] == input_code and (
                    time.time() - sms_store["send_time"]) < 15 * 60):
                code_valid = True

        if not code_valid: return "<script>alert('验证码错误或已过期');location.href='/change_password'</script>"
        if not check_password(old_p, user[
            "password"]): return "<script>alert('旧密码错误');location.href='/change_password'</script>"

        user["password"] = hash_password(new_p)
        write_json("user.json", user)
        sms_store["code"] = None
        return "<script>alert('密码修改成功！');location.href='/admin'</script>"

    return render_template_string('''
<div style="max-width:350px;margin:100px auto;background:#fff;padding:30px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1)">
    <h2 style="text-align:center;margin-bottom:24px">修改密码</h2>
    <form method="post" id="changeForm" autocomplete="off">
        <div style="margin-bottom:12px;">
            <input name="phone" id="phoneInput" placeholder="请输入绑定手机号" autocomplete="off" style="width:100%;padding:12px;border-radius:8px;border:1px solid #ddd;" required>
        </div>
        <div style="display:flex; gap:10px; margin-bottom:12px;">
            <input name="code" placeholder="请输入验证码" autocomplete="off" style="flex:1;padding:12px;border-radius:8px;border:1px solid #ddd" required>
            <button type="button" id="sendBtn" onclick="sendSms()" style="padding:0 15px; min-width:110px; white-space:nowrap; background:#1677ff; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:500;">获取验证码</button>
        </div>
        <div style="margin-bottom:12px;">
            <input name="old_password" type="password" placeholder="请输入旧密码" autocomplete="new-password" style="width:100%;padding:12px;border-radius:8px;border:1px solid #ddd" required>
        </div>
        <div style="margin-bottom:12px;">
            <input name="new_password" type="password" placeholder="请输入新密码" autocomplete="new-password" style="width:100%;padding:12px;border-radius:8px;border:1px solid #ddd" required>
        </div>
        <button type="submit" style="width:100%;padding:12px;background:#1677ff;color:white;border:none;border-radius:8px;cursor:pointer">确认修改</button>
    </form>
    <a href="/admin" style="display:block;text-align:center;margin-top:12px;color:#1677ff">返回管理后台</a>
    <script>
        let countdown = 0,timer=null;
        function sendSms(){
            const phone = document.getElementById('phoneInput').value.trim();
            if(!phone) {alert('请输入绑定手机号');return;}
            if(countdown>0)return;
            fetch('/api/send_sms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:phone})}).then(r=>r.json()).then(data=>{
                if(data.ok){alert('验证码：'+data.code);startTimer();}else{alert(data.msg);}
            });
        }
        function startTimer(){
            countdown={{RESEND_SECONDS}};
            const btn=document.getElementById('sendBtn');
            btn.disabled=true;btn.style.background='#ccc';btn.innerHTML=countdown+'s';
            if(timer)clearInterval(timer);
            timer=setInterval(()=>{
                countdown--;
                if(countdown<=0){clearInterval(timer);btn.innerHTML='获取验证码';btn.disabled=false;btn.style.background='#1677ff';}
                else{btn.innerHTML=countdown+'s';}
            },1000);
        }
    </script>
</div>
''', RESEND_SECONDS=RESEND_SECONDS)


@app.route("/api/send_sms", methods=["POST"])
def send_sms():
    d = request.json
    if d.get("phone") != BIND_PHONE: return jsonify({"ok": False, "msg": "手机号错误"})
    if time.time() - sms_store["send_time"] < RESEND_SECONDS: return jsonify({"ok": False, "msg": "请求频繁"})
    code = str(random.randint(100000, 999999))
    sms_store.update({"code": code, "phone": BIND_PHONE, "send_time": time.time()})
    print(f"验证码: {code}")
    return jsonify({"ok": True, "code": code})


# ===================== API接口 =====================
@app.route("/api/create_folder", methods=["POST"])
@login_required
def create_folder():
    try:
        d = request.json
        name, pid = d.get("name").strip(), d.get("parent_id", "")
        if not name: return jsonify({"ok": False, "msg": "名称不能为空"})
        if get_folder_level(read_json("files.json"), pid) >= MAX_FOLDER_LEVEL:
            return jsonify({"ok": False, "msg": f"最多{MAX_FOLDER_LEVEL}级目录"})
        items = read_json("files.json")
        items.append({
            "id": str(int(time.time() * 1000)) + str(random.randint(1000, 9999)),
            "name": name, "type": "folder", "label": "文件夹",
            "parent_id": pid, "time": time.strftime("%Y-%m-%d %H:%M")
        })
        write_json("files.json", items)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "msg": str(e)})


@app.route("/api/get_move_folders", methods=["POST"])
@login_required
def get_move_folders():
    try:
        items = read_json("files.json")
        exclude = request.json.get("exclude_id")
        folders = []
        for i in items:
            if i["type"] == "folder" and i["id"] != exclude:
                folders.append({"id": i["id"], "name": i["name"], "level": get_folder_level(items, i["id"])})
        folders.sort(key=lambda x: (x["level"], x["name"]))
        return jsonify({"ok": True, "folders": folders})
    except:
        return jsonify({"ok": False})


@app.route("/api/move_item", methods=["POST"])
@login_required
def move_item():
    try:
        d = request.json
        item_id = d.get("item_id")
        target_parent_id = d.get("target_parent_id", "")
        items = read_json("files.json")
        item = get_item_by_id(items, item_id)
        if not item: return jsonify({"ok": False, "msg": "项目不存在"})
        if item["type"] == "folder":
            if item_id == target_parent_id: return jsonify({"ok": False, "msg": "无法移动到自身文件夹"})
            if is_descendant(items, item_id, target_parent_id): return jsonify(
                {"ok": False, "msg": "禁止将父文件夹移动到子文件夹中"})
        item["parent_id"] = target_parent_id
        write_json("files.json", items)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "msg": f"移动失败：{str(e)}"})


@app.route("/api/rename_item", methods=["POST"])
@login_required
def rename_item():
    try:
        d = request.json
        item_id = d.get("item_id")
        new_name = d.get("new_name", "").strip()
        if not new_name: return jsonify({"ok": False, "msg": "名称不能为空"})
        items = read_json("files.json")
        item = get_item_by_id(items, item_id)
        if not item: return jsonify({"ok": False, "msg": "不存在"})
        item["name"] = new_name
        write_json("files.json", items)
        return jsonify({"ok": True})
    except:
        return jsonify({"ok": False, "msg": "重命名失败"})


@app.route("/api/chunk", methods=["POST"])
@login_required
def chunk():
    try:
        f = request.files["file"]
        fid = request.form['fid']
        idx = request.form['idx']
        if not os.path.exists("chunks"): os.makedirs("chunks")
        with open(f"chunks/{fid}_{idx}", "wb") as o:
            o.write(f.read())
        return jsonify({"ok": True})
    except Exception as e:
        print(f"Chunk error: {e}\n{traceback.format_exc()}")  # ✅ 修复：打印完整堆栈
        return jsonify({"ok": False, "msg": str(e)})


@app.route("/api/merge", methods=["POST"])
@login_required
def merge():
    temp_file = None
    try:
        d = request.json
        print(f"[DEBUG] 开始合并：fid={d['fid']}, name={d['name']}, total={d['total']}")

        # 1. 合并分片文件
        temp_file = f"chunks/{d['fid']}"
        with open(temp_file, "wb") as o:
            for i in range(d["total"]):
                p = f"chunks/{d['fid']}_{i}"
                if not os.path.exists(p):
                    raise Exception(f"分片文件 {p} 不存在")
                with open(p, "rb") as f:
                    o.write(f.read())
                os.remove(p)  # 合并后立即删除分片

        # 2. 上传到TG
        try:
            fid = tg_upload(temp_file, d["name"])
        except RetryError as e:
            # ✅ 修复：提取原始异常信息
            original_exc = e.last_attempt.exception() if hasattr(e, 'last_attempt') else e
            raise Exception(f"TG上传重试失败：{str(original_exc)}")

        # 3. 删除临时文件
        if os.path.exists(temp_file):
            os.remove(temp_file)

        # 4. 保存文件信息到JSON
        t, l = get_file_type(d["name"])
        items = read_json("files.json")
        new_item = {
            "id": str(int(time.time() * 1000)),
            "name": d["name"],
            "type": t, "label": l, "file_id": fid,
            "parent_id": d.get("parent_id", ""),
            "time": time.strftime("%Y-%m-%d %H:%M")
        }
        items.append(new_item)
        write_json("files.json", items)

        return jsonify({"ok": True, "item": new_item})

    except Exception as e:
        # ✅ 修复：打印完整错误堆栈，清理临时文件
        error_msg = f"合并失败：{str(e)}\n{traceback.format_exc()}"
        print(f"Merge error: {error_msg}")

        # 清理临时文件
        if temp_file and os.path.exists(temp_file):
            try:
                os.remove(temp_file)
            except:
                pass

        # 清理残留分片
        if d and d.get('fid'):
            for i in range(d.get("total", 0)):
                p = f"chunks/{d['fid']}_{i}"
                if os.path.exists(p):
                    try:
                        os.remove(p)
                    except:
                        pass

        return jsonify({"ok": False, "msg": str(e)})


@app.route("/delete/<id>", methods=["POST"])
@login_required
def delete(id):
    items = read_json("files.json")
    write_json("files.json", [i for i in items if i["id"] != id])
    return jsonify({"ok": True})


@app.route("/batch_delete", methods=["POST"])
@login_required
def batch_del():
    ids = request.json.get("ids", [])
    items = read_json("files.json")
    write_json("files.json", [i for i in items if i["id"] not in ids])
    return jsonify({"ok": True})

# ========== 测试 letsVPN 代理连通性 ==========
# def test_lets_vpn_proxy():
#     """测试letsVPN代理是否能访问Telegram API"""
#     try:
#         test_url = f"https://api.telegram.org/bot{BOT_TOKEN}/getMe"
#         response = requests.get(
#             test_url,
#             proxies=HTTP_PROXY_CONFIG,
#             timeout=10,
#             verify=False
#         )
#         if response.status_code == 200 and response.json().get("ok"):
#             print("✅ letsVPN 代理测试成功！")
#         else:
#             print("❌ letsVPN 代理测试失败：", response.text)
#     except Exception as e:
#         print("❌ letsVPN 代理测试失败：", str(e))

if __name__ == "__main__":
    init_user()
    port = int(os.getenv('PORT', 8080))
    app.run(host=os.getenv('BIND_IP', '0.0.0.0'), port=port, debug=False)