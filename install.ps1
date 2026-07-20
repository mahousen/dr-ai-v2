# 德仁口腔AI助手 v2 - Windows 一键安装
# 仓库是公开的，不需要 Token 即可下载
$ErrorActionPreference = 'Stop'
$API = 'https://api.github.com/repos/mahousen/dr-ai-v2/contents'
$RAW = 'https://raw.githubusercontent.com/mahousen/dr-ai-v2/master'
$INSTALL_DIR = Join-Path $env:USERPROFILE 'Desktop\德仁AI助手v2'

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  德仁口腔AI助手 v2 - 一键安装" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# === Step 1: Find Node.js ===
Write-Host "[1/5] 检查 Node.js..." -ForegroundColor Yellow
$nodeExe = $null
try { $nodeExe = (Get-Command node -ErrorAction Stop).Source } catch {}
if (-not $nodeExe -and (Test-Path 'C:\Program Files\nodejs\node.exe')) { $nodeExe = 'C:\Program Files\nodejs\node.exe' }
if (-not $nodeExe -and (Test-Path "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) { $nodeExe = "$env:LOCALAPPDATA\Programs\nodejs\node.exe" }
if (-not $nodeExe) {
    $wbNodes = Get-ChildItem 'C:\Users\*\.workbuddy\binaries\node\versions\*\node.exe' -ErrorAction SilentlyContinue
    if ($wbNodes) { $nodeExe = $wbNodes[0].FullName }
}

if (-not $nodeExe) {
    Write-Host "  未找到 Node.js，正在下载安装 v22.14.0..." -ForegroundColor DarkYellow
    $msiPath = Join-Path $env:TEMP 'node-install.msi'
    Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi' -OutFile $msiPath
    Write-Host "  正在安装（需要1-2分钟）..." -ForegroundColor DarkYellow
    Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /quiet /norestart" -Wait
    Remove-Item $msiPath -Force -ErrorAction SilentlyContinue
    $env:PATH = "$env:PATH;C:\Program Files\nodejs"
    $nodeExe = 'C:\Program Files\nodejs\node.exe'
}

if (-not (Test-Path $nodeExe)) {
    Write-Host "  [错误] Node.js 安装失败，请手动安装: https://nodejs.org" -ForegroundColor Red
    Read-Host "按回车退出"
    exit 1
}

$nodeVer = & $nodeExe -v
Write-Host "  Node.js: $nodeVer ($nodeExe)" -ForegroundColor Green

$npmDir = Split-Path $nodeExe
$npmExe = Join-Path $npmDir 'npm.cmd'

# === Step 2: Create directory ===
Write-Host ""
Write-Host "[2/5] 创建安装目录..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null
Set-Location $INSTALL_DIR
Write-Host "  $INSTALL_DIR" -ForegroundColor Green

# === Step 3: Download files from GitHub (public repo, no auth needed) ===
Write-Host ""
Write-Host "[3/5] 下载程序文件..." -ForegroundColor Yellow
$files = @('index.html', 'server.js', 'version.txt', 'check_update.js', 'check_update.py', 'package.json')
$allOk = $true
foreach ($f in $files) {
    $filePath = Join-Path $INSTALL_DIR $f
    $downloaded = $false
    # Try raw.githubusercontent.com first (faster, no rate limit)
    try {
        Invoke-WebRequest -Uri "$RAW/$f" -OutFile $filePath -TimeoutSec 15
        $downloaded = $true
        Write-Host "  OK: $f" -ForegroundColor Green
    } catch {
        Write-Host "  raw.githubusercontent.com 失败，尝试 API..." -ForegroundColor DarkYellow
    }
    # Fallback to API (base64 decode)
    if (-not $downloaded) {
        try {
            $resp = Invoke-RestMethod -Uri "$API/$f" -TimeoutSec 15
            $content = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($resp.content))
            [System.IO.File]::WriteAllText($filePath, $content, (New-Object System.Text.UTF8Encoding $false))
            $downloaded = $true
            Write-Host "  OK: $f (API)" -ForegroundColor Green
        } catch {
            Write-Host "  FAIL: $f - $($_.Exception.Message)" -ForegroundColor Red
            $allOk = $false
        }
    }
}

# === Step 4: Install npm dependencies ===
Write-Host ""
Write-Host "[4/5] 安装依赖..." -ForegroundColor Yellow
$env:PATH = "$npmDir;$env:PATH"
try {
    & $npmExe install 2>&1 | Out-Host
    Write-Host "  依赖安装完成" -ForegroundColor Green
} catch {
    Write-Host "  npm install 出错，尝试直接安装 ws..." -ForegroundColor DarkYellow
    & $nodeExe -e "require('child_process').execSync('npm install ws',{stdio:'inherit'})"
}

# === Step 5: Create desktop launcher ===
Write-Host ""
Write-Host "[5/5] 创建桌面快捷方式..." -ForegroundColor Yellow
$batPath = Join-Path $env:USERPROFILE 'Desktop\德仁AI助手v2.bat'
$batContent = @"
@echo off
chcp 65001 >nul 2>&1
cd /d "$INSTALL_DIR"
echo [1/3] Checking update...
"$nodeExe" check_update.js
echo [2/3] Starting server...
start "dr-ai-v2" "$nodeExe" server.js
ping 127.0.0.1 -n 4 >nul
echo [3/3] Opening browser...
start http://localhost:8080
echo Done! http://localhost:8080
pause
"@
[System.IO.File]::WriteAllText($batPath, $batContent, [System.Text.Encoding]::Default)
Write-Host "  桌面快捷方式: $batPath" -ForegroundColor Green

# === Done ===
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  安装完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  双击桌面的「德仁AI助手v2」即可启动" -ForegroundColor White
Write-Host ""

# Auto start
Write-Host "是否立即启动？(Y/N)" -ForegroundColor Yellow
$key = Read-Host
if ($key -eq 'Y' -or $key -eq 'y' -or $key -eq '') {
    Start-Process $batPath
}
