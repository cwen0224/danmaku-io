# 彈幕IO

單手滑鼠操作的簡易 IO 小遊戲。

## 操作
- 移動滑鼠：角色跟隨游標移動
- 斬擊方向：自動朝滑鼠角度斬擊
- 目標：盡量生存、擊殺更多敵人

## 本機執行
直接打開 `index.html` 即可。

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
