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

## 部署 Relay 到 Fly.io
1. 安裝並登入 `flyctl`。
2. 在專案根目錄執行：

```bash
fly launch --no-deploy
```

3. 檢查 [fly.toml](C:\Users\Sang\Desktop\彈幕IO\fly.toml) 的 `app` 名稱是否可用，不可用就改成新的唯一名稱。
4. 部署：

```bash
fly deploy
```

5. 部署完成後，取得網址：

```text
wss://<你的-fly-app>.fly.dev
```

6. 編輯 [index.html](C:\Users\Sang\Desktop\彈幕IO\index.html)，把這行改成你的 Fly 網址：

```html
window.DANMAKU_WS_URL = "wss://<你的-fly-app>.fly.dev";
```

7. 推送到 GitHub，Pages 更新後，玩家直接開網頁就會自動連到 Fly relay。
8. 也可以先用網址參數測試，不改預設值：

```text
https://<你的帳號>.github.io/<repo>/?mp=wss://<你的-fly-app>.fly.dev
```

## Fly 檔案
- [fly.toml](C:\Users\Sang\Desktop\彈幕IO\fly.toml)：Fly app 設定
- [Dockerfile](C:\Users\Sang\Desktop\彈幕IO\Dockerfile)：Node relay 容器
- [.dockerignore](C:\Users\Sang\Desktop\彈幕IO\.dockerignore)：縮小 build context

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
