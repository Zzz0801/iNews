# 今日头条·简版（Express + Web）

## 启动

1. 安装依赖
```
npm install
```
2. 启动服务
```
npm start
```
访问 `http://localhost:3000`。

## 目录
- `server.js` 后端（Express，提供文章/分类/热榜/点赞API，并托管前端静态资源）
- `data/articles.json` Mock数据
- `public/` 前端
  - `index.html` 页面
  - `styles.css` 样式
  - `app.js` 交互逻辑

## API
- GET `/api/categories`
- GET `/api/articles?category=all|hot|tech|ent|sport&q=关键词&cursor=&limit=10`
- GET `/api/articles/:id`
- GET `/api/trending`
- POST `/api/articles/:id/like`
 - GET `/api/news?q=关键词&page=1&pageSize=10` （代理 NewsAPI）

## 功能
- 推荐/分类切换
- 搜索
- 无限滚动
- 热榜
- 点赞
 - 资讯（来自 NewsAPI）

参考：`NewsAPI` 文档与示例请求见 [newsapi.org](https://newsapi.org/)。


