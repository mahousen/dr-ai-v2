#!/usr/bin/env python3
"""德仁口腔AI助手 - 自动更新脚本
从GitHub API拉取最新文件，不依赖git命令，纯HTTP更新。
"""
import json, base64, sys, os
from urllib.request import Request, urlopen
from urllib.error import URLError

OWNER = "mahousen"
REPO = "dr-ai-v2"
API = f"https://api.github.com/repos/{OWNER}/{REPO}/contents"
TIMEOUT = 15

def fetch_file(path):
    req = Request(f"{API}/{path}")
    with urlopen(req, timeout=TIMEOUT) as resp:
        data = json.loads(resp.read())
        return base64.b64decode(data["content"])

def get_remote_version():
    content = fetch_file("version.txt")
    return content.decode("utf-8").strip()

def get_local_version():
    try:
        with open("version.txt", "r", encoding="utf-8") as f:
            return f.read().strip()
    except:
        return ""

def download_and_save(fname):
    content = fetch_file(fname)
    with open(fname, "wb") as f:
        f.write(content)

def main():
    print("检查更新...", end=" ", flush=True)
    try:
        remote = get_remote_version()
        local = get_local_version()
    except URLError:
        print("网络不可达，跳过更新")
        return
    except Exception as e:
        print(f"检查失败: {e}")
        return

    if local == remote:
        print(f"已是最新 ({local})")
        return

    print(f"发现新版本: {remote} (当前: {local or '无'})")
    print("正在更新...")

    files = ["index.html", "server.js", "version.txt", "check_update.py"]
    for fname in files:
        try:
            download_and_save(fname)
            print(f"  OK  {fname}")
        except Exception as e:
            print(f"  ERR {fname}: {e}")

    print("更新完成！")

if __name__ == "__main__":
    main()
