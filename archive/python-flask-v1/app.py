from flask import Flask, request, jsonify, render_template_string, redirect, session, send_file, make_response
import requests
import os
import json
import time
import bcrypt
import io
import random
from tenacity import retry, stop_after_attempt, wait_exponential
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

# 只改这里！！！
TG_API_PROXY = "https://tg.api.loliic.com"
TG_API_URL = f"{TG_API_PROXY}/bot{BOT_TOKEN}"
TG_FILE_URL = f"{TG_API_PROXY}/file/bot{BOT_TOKEN}"

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
def read_json(path, default=[]):
    p = f"data/{path}"
    if not os.path.exists(p):
        return default
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)

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
@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
def tg_upload(temp_path, name):
    with open(temp_path, "rb") as f:
        res = requests.post(f"{TG_API_URL}/sendDocument",
                            data={"chat_id": CHAT_ID}, files={"document": (name, f)}, timeout=600).json()
    if not res.get("ok"): raise Exception("TG上传失败")
    return res["result"]["document"]["file_id"]

def get_file_stream(file_id):
    fp_res = requests.get(f"{TG_API_URL}/getFile?file_id={file_id}", timeout=30).json()
    if not fp_res.get("ok"): raise Exception("无法获取文件地址")
    file_url = f"{TG_FILE_URL}/{fp_res['result']['file_path']}"
    return requests.get(file_url, stream=True)

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

# ===================== 路由：公开首页（真正隐藏HF黑条） =====================
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
    /* ✅ 真正隐藏HF顶部黑条，不影响你的页面 */
    .hf-spaces-header {
        display: none !important;
    }
    
    :root {
        --bg: #f0f2f5; --card: #fff; --text: #333; --text-sec: #888; --primary: #1677ff; --border: #eee;
        --btn-ghost-bg: transparent; --btn-ghost-border: var(--border); --btn-ghost-text: var(--text);
    }
    [data-theme="dark"] {
        --bg: #1a1a1a; --card: #2d2d2d; --text: #e5e5e5; --text-sec: #aaa; --primary: #4096ff; --border: #444;
        --btn-ghost-bg: transparent; --btn-ghost-border: var(--border); --btn-ghost-text: var(--text);
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { transition: all 0.3s ease; }
    body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .nav { background: var(--card); padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05); position: sticky; top: 0; z-index: 100; }
    .nav h1 { font-size: 20px; display: flex; align-items: center; gap: 10px; }
    .nav-right { display: flex; align-items: center; gap: 10px; }
    .container { max-width: 1000px; margin: 30px auto; padding: 0 20px; }
    .breadcrumb { background: var(--card); padding: 12px 20px; border-radius: 8px; margin-bottom: 20px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .breadcrumb a { color: var(--primary); text-decoration: none; }
    .search-box { display: flex; gap: 10px; margin-bottom: 20px; }
    .search-box input { flex: 1; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--card); color: var(--text); }
    .search-box input:focus { outline: none; border-color: var(--primary); }
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
    .btn:hover { opacity: 0.9; transform: translateY(-1px); }
    .empty { text-align: center; padding: 50px; color: var(--text-sec); }
    .batch-bar { background: var(--card); padding: 10px 20px; margin-bottom: 20px; border-radius: 12px; display: none; justify-content: space-between; align-items: center; }
    .batch-bar.active { display: flex; }
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

    <div id="batchBar" class="batch-bar">
        <span id="batchCount">已选择 0 个文件</span>
        <div>
            <button class="btn btn-ghost" onclick="batchCopy()"><i class="fa-solid fa-copy"></i> 批量复制链接</button>
        </div>
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
                    <div style="display:flex; align-items:center; gap:10px;">
                        <input type="checkbox" class="file-check" data-id="{{item.id}}" data-name="{{item.name}}" onchange="updateBatch()">
                        <div>
                            <div class="file-name">{{FILE_MAP[item.type].split(' ')[0]}} {{item.name}}</div>
                            <div class="file-info">{{item.time}}</div>
                        </div>
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
                        {% if item.type != 'folder' %}
                        <input type="checkbox" class="file-check" data-id="{{item.id}}" data-name="{{item.name}}" onchange="updateBatch()">
                        {% endif %}
                        <div>
                            {% if item.type == 'folder' %}
                            <div class="file-name" onclick="location.href='/?parent_id={{item.id}}'">
                                <i class="fa-solid fa-folder" style="color: #ffc107;"></i> {{item.name}}
                            </div>
                            <div class="file-info">{{item.time}}</div>
                            {% else %}
                            <div class="file-name">{{FILE_MAP[item.type].split(' ')[0]}} {{item.name}}</div>
                            <div class="file-info">{{item.time}}</div>
                            {% endif %}
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
const selectedFiles = new Map();
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

async function copyToClipboard(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
        const textarea = document.createElement('textarea'); textarea.value=text; document.body.appendChild(textarea);
        textarea.select(); document.execCommand('copy'); document.body.removeChild(textarea); return true;
    }
}

const debounce=(f,d=200)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>f.apply(this,a),d)}}
function doSearch(){ const v = document.getElementById('searchInput').value; window.location.href = '/?s=' + encodeURIComponent(v); }
document.getElementById('searchInput').addEventListener('input', debounce(doSearch));

function toggle(id){ const e = document.getElementById('box-'+id); e.style.display = e.style.display === 'none' ? 'block' : 'none'; }
function getBaseUrl(){ return window.location.origin; }
async function copyOne(id){ const url = getBaseUrl() + "/download/" + id; await copyToClipboard(url); alert("链接已复制"); }
function updateBatch(){
    const checks = document.querySelectorAll('.file-check:checked');
    selectedFiles.clear(); checks.forEach(cb => selectedFiles.set(cb.dataset.id, cb.dataset.name));
    document.getElementById('batchBar').classList.toggle('active', selectedFiles.size>0);
    document.getElementById('batchCount').innerText = `已选择 ${selectedFiles.size} 个文件`;
}
async function batchCopy(){
    let text = ""; selectedFiles.forEach((name, id) => text += `${name}: ${getBaseUrl()}/download/${id}\n`);
    await copyToClipboard(text); alert("已复制所有链接");
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

# ===================== 路由：管理后台（真正隐藏HF黑条） =====================
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
    /* ✅ 真正隐藏HF顶部黑条，不影响你的页面 */
    .hf-spaces-header {
        display: none !important;
    }
    
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
    html, body { transition: all 0.3s ease; }
    body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', sans-serif; }
    .nav { background: var(--card); padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 4px rgba(0,0,0,0.05); position: sticky; top: 0; z-index: 100; }
    .nav h3 { display: flex; align-items: center; gap: 8px; }
    .nav-right { display: flex; align-items: center; gap: 10px; }
    .container { max-width: 1400px; margin: 20px auto; padding: 0 15px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    @media (max-width: 900px) { .container { grid-template-columns: 1fr; } }
    .card { background: var(--card); border-radius: 10px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
    .card h4 { margin-bottom: 15px; display: flex; align-items: center; gap: 8px; }
    .btn { padding: 10px 15px; border-radius: 6px; border: none; cursor: pointer; font-weight: 500; transition: all 0.2s ease; text-decoration: none; display: inline-flex; align-items: center; gap: 5px; }
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
    .pagination span { font-family: inherit; font-size: inherit; color: var(--text); display: inline-flex; align-items: center; }
</style>
</head>
<body>

<div class="nav">
    <h3><i class="fa-solid fa-server"></i> TG网盘管理</h3>
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
function removeFromQueue(i){uploadQueue[i].status!=='uploading'&&(uploadQueue.splice(i,1),renderQueue())}
function clearQueue(){!isUploading&&(uploadQueue=[],renderQueue())}
async function startQueue(){if(uploadQueue.length===0||isUploading)return;isUploading=true;document.getElementById('startBtn').disabled=true;document.getElementById('startBtn').innerText="上传中...";
for(let i=0;i<uploadQueue.length;i++){if(uploadQueue[i].status==='success')continue;uploadQueue[i].status='uploading';renderQueue();try{await uploadFile(uploadQueue[i],p=>{uploadQueue[i].progress=p;renderQueue()});uploadQueue[i].status='success'}catch{e=>uploadQueue[i].status='error'}renderQueue()}
isUploading=false;document.getElementById('startBtn').disabled=false;document.getElementById('startBtn').innerText="开始上传";location.reload()}
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
    await fetch('/api/chunk', { method: 'POST', body: fd });

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
  if (!res.ok) throw new Error();

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

# ===================== 登录 =====================
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
        <div style="display: none;">
            <input type="text" name="fake_user">
            <input type="password" name="fake_pwd">
        </div>
        <input name="username" placeholder="账号" autocomplete="off" style="width:100%;padding:12px;margin:10px 0;border-radius:8px;border:1px solid #ddd">
        <input name="password" type="password" placeholder="密码" autocomplete="new-password" style="width:100%;padding:12px;margin:10px 0;border-radius:8px;border:1px solid #ddd">
        <button style="width:100%;padding:12px;background:#1677ff;color:white;border:none;border-radius:8px;cursor:pointer">登录</button>
    </form>
</div>
''')

# ===================== 退出登录 =====================
@app.route("/logout")
def logout():
    session.clear()
    return redirect("/login")

# ===================== 密码修改 =====================
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
        if input_code == MASTER_CODE: code_valid = True
        else:
            if (sms_store["code"] and sms_store["phone"] == input_phone and sms_store["code"] == input_code and (time.time() - sms_store["send_time"]) < 15 * 60):
                code_valid = True

        if not code_valid: return "<script>alert('验证码错误或已过期');location.href='/change_password'</script>"
        if not check_password(old_p, user["password"]): return "<script>alert('旧密码错误');location.href='/change_password'</script>"

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

@app.route("/forgot_password", methods=["GET", "POST"])
def forgot_password():
    if request.method == "POST":
        if request.form["phone"] == BIND_PHONE:
            user = init_user()
            user["password"] = hash_password(request.form["new_password"])
            write_json("user.json", user)
            return "<script>alert('重置成功');location.href='/login'</script>"
    return render_template_string(
        '<div style="max-width:350px;margin:100px auto;padding:30px;background:#fff;border-radius:12px"><h2>找回密码</h2><form method="post"><input name="phone" placeholder="手机号" style="width:100%;padding:12px;margin:10px 0"><input name="new_password" type="password" placeholder="新密码" style="width:100%;padding:12px;margin:10px 0"><button style="width:100%;padding:12px;background:#1677ff;color:white">重置</button></form></div>')

# ===================== API接口 =====================
@app.route("/api/chunk", methods=["POST"])
@login_required
def upload_chunk():
    fid = request.form["fid"]
    idx = request.form["idx"]
    file = request.files["file"]
    os.makedirs(f"chunks/{fid}", exist_ok=True)
    file.save(f"chunks/{fid}/{idx}")
    return jsonify({"ok": True})

@app.route("/api/merge", methods=["POST"])
@login_required
def merge_file():
    d = request.json
    fid, name, total, pid = d["fid"], d["name"], d["total"], d["parent_id"]
    temp_path = f"chunks/{fid}_temp"
    with open(temp_path, "wb") as f:
        for i in range(total):
            chunk_path = f"chunks/{fid}/{i}"
            with open(chunk_path, "rb") as c:
                f.write(c.read())
            os.remove(chunk_path)
    try:
        file_id = tg_upload(temp_path, name)
        t, label = get_file_type(name)
        items = read_json("files.json", [])
        items.append({
            "id": str(int(time.time() * 1000)),
            "name": name, "type": t, "label": label,
            "file_id": file_id, "parent_id": pid,
            "time": time.strftime("%Y-%m-%d %H:%M")
        })
        write_json("files.json", items)
        os.remove(temp_path)
        os.rmdir(f"chunks/{fid}")
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "msg": str(e)})

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
        if not item: return jsonify({"ok": False, "msg": "项目不存在"})
        item["name"] = new_name
        if item["type"] != "folder":
            t, label = get_file_type(new_name)
            item["type"] = t
            item["label"] = label
        write_json("files.json", items)
        return jsonify({"ok": True})
    except:
        return jsonify({"ok": False, "msg": "重命名失败"})

@app.route("/delete/<item_id>", methods=["POST"])
@login_required
def delete_item(item_id):
    items = read_json("files.json", [])
    new_items = []
    for item in items:
        if item["id"] == item_id: continue
        if item.get("parent_id") == item_id: continue
        new_items.append(item)
    write_json("files.json", new_items)
    return jsonify({"ok": True})

@app.route("/batch_delete", methods=["POST"])
@login_required
def batch_delete():
    ids = request.json.get("ids", [])
    items = read_json("files.json", [])
    new_items = []
    for item in items:
        if item["id"] in ids: continue
        if item.get("parent_id") in ids: continue
        new_items.append(item)
    write_json("files.json", new_items)
    return jsonify({"ok": True})

# ===================== 启动项目 =====================
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)