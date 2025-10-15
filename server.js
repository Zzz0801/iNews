

import express from 'express';
import path from 'path';
import morgan from 'morgan';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fs from 'fs';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(morgan('dev'));

const PUBLIC_DIR = path.join(__dirname, 'public');
const NEWS_API_KEY = process.env.NEWS_API_KEY || '94a9a8ccb60445889de205f2c11a0f6f';
const PROXY_URL = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
const DATA_FILE = path.join(__dirname, 'data.json'); // ✅ 数据文件路径

let db = { users: [], likesDB: {} };
// In-memory article store and comments store
const articleStore = {}; // id -> { id, title, summary, cover, content, url, source, category, publishedAt }
const commentsDB = {}; // id -> [{ username, text, createdAt }]


// 启动时读取旧数据
if (fs.existsSync(DATA_FILE)) {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);

    db.users = parsed.users || [];
    // likesDB 中的 users 从 JSON 数组还原为 Set
    db.likesDB = {};
    for (const [id, val] of Object.entries(parsed.likesDB || {})) {
      db.likesDB[id] = {
        count: val.count || 0,
        users: new Set(val.users || []),
      };
    }
    // restore persisted articleStore and commentsDB if present
    if (parsed.articleStore && typeof parsed.articleStore === 'object') {
      Object.assign(articleStore, parsed.articleStore);
    }
    if (parsed.commentsDB && typeof parsed.commentsDB === 'object') {
      Object.assign(commentsDB, parsed.commentsDB);
    }
    console.log('✅ 数据已从 data.json 加载');
  } catch (err) {
    console.error('⚠️ 加载 data.json 失败:', err);
  }
}

// 保存到文件的函数
function saveDB() {
  const toSave = {
    users: db.users,
    // 将 Set 转为数组便于 JSON 序列化
    likesDB: Object.fromEntries(
      Object.entries(db.likesDB).map(([id, val]) => [
        id,
        { count: val.count, users: Array.from(val.users) },
      ])
    ),
    // persist article metadata and comments
    articleStore,
    commentsDB,
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(toSave, null, 2));
}

// 便捷引用
const { users, likesDB } = db;

function logAnd500(res, tag, err) {
  console.error(`[${tag}]`, err && (err.stack || err.message || err));
  return res.status(500).json({ error: String(err && (err.message || err)), tag });
}

function makeIdFromUrl(url) {
  if (!url) return `local_${Date.now()}`;
  return crypto.createHash('sha1').update(String(url)).digest('hex');
}

app.use(express.static(PUBLIC_DIR));

// HTTP fetch helper
async function httpJSON(url, { timeoutMs = 10000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const options = { signal: ac.signal };
    if (PROXY_URL) {
      options.agent = new HttpsProxyAgent(PROXY_URL);
    }
    const r = await fetch(url, options);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(`HTTP ${r.status}: ${data.message || data.error || 'Unknown error'}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

app.get("/api/news", async (req, res) => {
  // extract query params here so they are available in the catch block
  const { category = "tech", q = "", page = 1, pageSize = 10 } = req.query;
  try {

    const categoryMap = {
      tech: "technology",
      china: "business",
      world: "general",
      sports: "sports",
    };

    const url = `https://newsapi.org/v2/top-headlines?${new URLSearchParams({
      category: categoryMap[category] || "general",
      q,
      country: "us",
      page: String(page),
      pageSize: String(pageSize),
      apiKey: NEWS_API_KEY,
    }).toString()}`;

    const data = await httpJSON(url);

    // 统一加入本地点赞数
    const items = (data.articles || []).map((n, idx) => {
      const id = makeIdFromUrl(n.url) || `news_${category}_${page}_${idx}`;
      // persist minimal meta
      articleStore[id] = {
        id,
        title: n.title,
        summary: n.description,
        cover: n.urlToImage,
        category,
        publishedAt: n.publishedAt,
        url: n.url,
        source: n.source?.name || "",
      };
      const count = likesDB[id]?.count || 0;
      return {
        id,
        title: n.title,
        summary: n.description,
        cover: n.urlToImage,
        category,
        publishedAt: n.publishedAt,
        likes: count,
        url: n.url,
        source: n.source?.name || "",
      };
    });

    res.json({ items, totalResults: data.totalResults || 0 });
  } catch (e) {
    console.error('[api/news] external fetch failed:', e && e.message);
    // Fallback: return some local mock articles so UI still works offline
    const sample = [
      {
        id: `local_${Date.now()}_1`,
        title: `示例文章 - ${category} - 1`,
        summary: `这是分类 ${category} 的示例摘要，用于离线展示。`,
        cover: '',
        category,
        publishedAt: new Date().toISOString(),
        likes: 0,
        url: ''
      },
      {
        id: `local_${Date.now()}_2`,
        title: `示例文章 - ${category} - 2`,
        summary: `第二条示例内容，帮助测试分类过滤。`,
        cover: '',
        category,
        publishedAt: new Date().toISOString(),
        likes: 0,
        url: ''
      }
    ];
    return res.json({ items: sample, totalResults: sample.length });
  }
});

// article detail
app.get('/api/articles/:id', (req, res) => {
  const { id } = req.params;
  const a = articleStore[id];
  if (!a) return res.status(404).json({ error: 'Not found' });
  const likes = likesDB[id]?.count || 0;
  return res.json({ ...a, likes });
});

// comments
app.get('/api/articles/:id/comments', (req, res) => {
  const { id } = req.params;
  const username = req.query.username;
  const items = commentsDB[id] || [];
  // ensure older comments have ids and likedBy array
  let mutated = false;
  const out = items.map((it) => {
    if (!it.id) {
      it.id = crypto.createHash('sha1').update(`${id}|${it.username}|${it.createdAt}|${it.text}`).digest('hex');
      it.likedBy = it.likedBy || [];
      mutated = true;
    }
    const likes = (it.likedBy && Array.isArray(it.likedBy)) ? it.likedBy.length : (it.likes || 0);
    const liked = username && it.likedBy && it.likedBy.includes(username);
    return Object.assign({}, it, { likes, liked: !!liked });
  });
  if (mutated) {
    try { saveDB(); } catch(_) {}
  }
  res.json({ items: out });
});
app.post('/api/articles/:id/comments', (req, res) => {
  const { id } = req.params;
  const { username, text } = req.body;
  if (!username) return res.status(401).json({ error: '请先登录' });
  if (!text || !text.trim()) return res.status(400).json({ error: '评论不能为空' });

  const createdAt = new Date().toISOString();
  const commentId = crypto.createHash('sha1').update(`${id}|${username}|${createdAt}|${text.trim()}`).digest('hex');
  const item = { id: commentId, username, text: text.trim(), createdAt, likedBy: [], likes: 0 };
  if (!commentsDB[id]) commentsDB[id] = [];
  commentsDB[id].push(item);
  try { saveDB(); } catch(_) {}
  return res.json({ ok: true, comment: item });
});

// comment like toggle (per-comment)
app.post('/api/articles/:id/comments/:commentId/like', (req, res) => {
  const { id, commentId } = req.params;
  const { username } = req.body;
  if (!username) return res.status(401).json({ error: '请先登录' });
  const items = commentsDB[id] || [];
  const c = items.find(x => x.id === commentId);
  if (!c) return res.status(404).json({ error: 'comment not found' });
  c.likedBy = Array.isArray(c.likedBy) ? c.likedBy : (c.likedBy ? Array.from(c.likedBy) : []);
  const idx = c.likedBy.indexOf(username);
  let liked = false;
  if (idx >= 0) {
    c.likedBy.splice(idx, 1);
    liked = false;
  } else {
    c.likedBy.push(username);
    liked = true;
  }
  c.likes = c.likedBy.length;
  try { saveDB(); } catch(_) {}
  return res.json({ likes: c.likes, liked });
});

// ✅ 分类接口
app.get("/api/categories", (req, res) => {
  const categories = [
    { id: "tech", name: "科技" },
    { id: "china", name: "商业" },
    { id: "world", name: "国际" },
    { id: "sports", name: "体育" },
    { id: "news", name: "综合" }
  ];
  res.json({ categories });
});


// ========== 用户系统（Express 实现） ==========
app.post("/api/register", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "缺少参数" });
  if (users.find((u) => u.username === username))
    return res.status(400).json({ error: "用户名已存在" });
  users.push({ username, password });
  saveDB(); 
  res.json({ message: "注册成功" });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const u = users.find((x) => x.username === username && x.password === password);
  if (!u) return res.status(401).json({ error: "用户名或密码错误" });
  res.json({ message: "登录成功", username });
});

// ========== 点赞接口（Express 维护） ==========
app.post("/api/articles/:id/like", (req, res) => {
  const { username } = req.body;
  const { id } = req.params;
  if (!username) return res.status(401).json({ error: "请先登录" });

  if (!likesDB[id]) likesDB[id] = { count: 0, users: new Set() };

  if (likesDB[id].users.has(username)) {
    // 用户已点赞 -> 取消点赞
    likesDB[id].users.delete(username);
    likesDB[id].count--;
    saveDB(); 
    return res.json({ likes: likesDB[id].count, liked: false });
  } else {
    // 用户未点赞 -> 点赞
    likesDB[id].users.add(username);
    likesDB[id].count++;
    saveDB(); 
    return res.json({ likes: likesDB[id].count, liked: true });
  }
});


// ✅ /api/trending 显示最热门新闻
app.get('/api/trending', async (req, res) => {
  try {
    const url = `https://newsapi.org/v2/top-headlines?${new URLSearchParams({
      country: 'us',
      category: 'technology',
      pageSize: '10',
      apiKey: NEWS_API_KEY
    }).toString()}`;
    const data = await httpJSON(url);
    const items = (data.articles || []).map((n, idx) => {
      // n 就是每篇文章
      const id = makeIdFromUrl(n.url) || `trend_${idx}`; // 使用 URL 的 sha1 作为稳定 id
      // persist minimal meta if first seen
      if (!articleStore[id]) {
        articleStore[id] = {
          id,
          title: n.title,
          summary: n.description,
          cover: n.urlToImage,
          category: 'tech',
          publishedAt: n.publishedAt,
          url: n.url,
          source: n.source?.name || '',
        };
        try { saveDB(); } catch(_) {}
      }
      const count = likesDB[id]?.count || 0; // 从本地数据库取点赞数

      return {
        id,
        title: n.title,
        url: n.url,
        likes: count,
      };
    });
    res.json({ items });
  } catch (e) {
    console.error('[api/trending] external fetch failed:', e && e.message);
    // Fallback: return some local trending items so UI still works
    const sample = [
      { id: 'local_tr_1', title: '本地示例热点 1', url: '', likes: 0 },
      { id: 'local_tr_2', title: '本地示例热点 2', url: '', likes: 0 },
      { id: 'local_tr_3', title: '本地示例热点 3', url: '', likes: 0 }
    ];
    return res.json({ items: sample });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
