# 彈幕IO

單手滑鼠操作的簡易 IO 小遊戲。

## 操作
- 移動滑鼠：角色跟隨游標移動
- 斬擊方向：自動朝滑鼠角度斬擊
- 目標：盡量生存、擊殺更多敵人

## 本機執行
直接打開 `index.html` 即可。

## V1.1 連機測試（WebSocket）
1. 安裝依賴：
```bash
npm install
```
2. 啟動 relay server：
```bash
npm run start:server
```
3. 開兩個瀏覽器視窗（或兩台電腦）連到同一個 server：
```text
index.html?mp=ws://localhost:8080
```
4. 畫面上方 `連線` 會顯示 `已連線(n)`，並看到其他玩家位置與朝向。

## 部署 Relay 到 Oracle Cloud
建議路線：`OCI Always Free VM + Docker + Caddy`。

原因：
- GitHub Pages 只能放前端靜態檔。
- 多人 relay 需要常駐後端。
- GitHub Pages 頁面要連線時，後端最好提供 `wss://`，所以需要 TLS。

### 1. 建立 OCI VM
建議直接建一台 `Always Free` VM，系統用 `Ubuntu 24.04` 或其他 Ubuntu LTS。

Oracle 官方文件：
- Always Free VM：<https://www.oracle.com/cloud/free/>
- SSH 連線與 VM 管理：<https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/connect-to-instance.htm>
- 安全規則 / ingress：<https://docs.oracle.com/en-us/iaas/Content/Network/Concepts/securitylists.htm>

安全規則至少要開：
- `22/tcp`
- `80/tcp`
- `443/tcp`

### 2. 安裝 Docker
依 Docker 官方 Ubuntu 文件安裝：
- <https://docs.docker.com/engine/install/ubuntu/>

### 3. 把專案拉到 VM
```bash
git clone https://github.com/cwen0224/danmaku-io.git
cd danmaku-io
```

### 4. 設定網域
你需要一個可指向 Oracle VM 公網 IP 的網域或子網域。

這是必要條件：
- 你的 GitHub Pages 是 `https://`。
- 瀏覽器通常要求多人 relay 走 `wss://`。
- `wss://` 要有有效 TLS 憑證，最穩是用網域讓 Caddy 自動簽。

### 5. 啟動 Relay + TLS
在 VM 上設定環境變數後啟動：

```bash
export APP_DOMAIN=relay.example.com
export APP_EMAIL=you@example.com
docker compose -f compose.oracle.yml up -d --build
```

部署檔：
- [compose.oracle.yml](C:\Users\Sang\Desktop\彈幕IO\compose.oracle.yml)
- [deploy/oracle/Caddyfile](C:\Users\Sang\Desktop\彈幕IO\deploy\oracle\Caddyfile)
- [Dockerfile](C:\Users\Sang\Desktop\彈幕IO\Dockerfile)

### 6. 測試 Relay
```bash
curl https://relay.example.com/health
```

正常時會回傳 JSON，包含 `ok`、`clients`、`enemies`。

### 7. 讓前端改連 Oracle
先用網址參數測：

```text
https://<你的帳號>.github.io/<repo>/?mp=wss://relay.example.com
```

確認沒問題後，再把 [index.html](C:\Users\Sang\Desktop\彈幕IO\index.html) 這行改成：

```html
window.DANMAKU_WS_URL = "wss://relay.example.com";
```

## 部署到 GitHub Pages

1. 在 GitHub 建立新 repo（例如 `danmaku-io`）。
2. 在本機專案根目錄執行：

```bash
git init
git branch -M main
git add .
git commit -m "feat: initial playable io prototype"
git remote add origin https://github.com/<你的帳號>/<你的repo>.git
git push -u origin main
```

3. 到 GitHub 專案頁面：`Settings > Pages`。
4. `Source` 選 `GitHub Actions`。
5. 等待 `Deploy static site to GitHub Pages` workflow 跑完。
6. 網址會是：
   - `https://<你的帳號>.github.io/<你的repo>/`

## 檔案說明
- `index.html`：主頁
- `style.css`：介面樣式
- `game.js`：核心玩法
- `.github/workflows/deploy-pages.yml`：自動部署流程
