// import express from 'express';
// import path from 'path';
// import morgan from 'morgan';
// import { fileURLToPath } from 'url';
// import fetch from 'node-fetch';
// import NewsAPI from 'newsapi';
// import { HttpsProxyAgent } from 'https-proxy-agent';

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// const app = express();
// app.use(express.json());
// app.use(morgan('dev'));

// const PUBLIC_DIR = path.join(__dirname, 'public');
// const NEWS_API_KEY = process.env.NEWS_API_KEY || '94a9a8ccb60445889de205f2c11a0f6f';
// const PROXY_URL = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
// let newsapi = null;
// try {
//   // If a proxy is configured, prefer HTTP mode so we can attach the agent
//   if (!PROXY_URL) {
//     newsapi = new NewsAPI(NEWS_API_KEY);
//     console.log('[newsapi] SDK initialized');
//   } else {
//     console.log('[newsapi] Proxy detected, using HTTP mode with agent');
//   }
// } catch (e) {
//   newsapi = null;
//   console.warn('[newsapi] SDK init failed, will use HTTP fallback:', e.message);
// }

// function logAnd500(res, tag, err) {
//   console.error(`[${tag}]`, err && (err.stack || err.message || err));
//   return res.status(500).json({ error: String(err && (err.message || err)), tag });
// }

// app.use(express.static(PUBLIC_DIR));

// // Cursor helper
// function encodeCursor(n){ return Buffer.from(String(n)).toString('base64'); }
// function decodeCursor(s){ return parseInt(Buffer.from(s, 'base64').toString('utf-8'), 10) || 0; }

// // HTTP helper with proxy/timeout
// async function httpJSON(url, { timeoutMs = 10000 } = {}) {
//   const ac = new AbortController();
//   const timer = setTimeout(() => ac.abort(), timeoutMs);
//   try {
//     const options = { signal: ac.signal };
//     if (PROXY_URL) {
//       options.agent = new HttpsProxyAgent(PROXY_URL);
//     }
//     const r = await fetch(url, options);
//     const data = await r.json().catch(() => ({}));
//     if (!r.ok) {
//       const msg = data && (data.message || data.error) ? (data.message || data.error) : `HTTP ${r.status}`;
//       const err = new Error(msg);
//       err.status = r.status;
//       throw err;
//     }
//     return data;
//   } finally {
//     clearTimeout(timer);
//   }
// }

// // Routes
// app.get('/api/categories', (req, res) => {
//   res.json({ categories: [ { id: 'news', name: '资讯' } ] });
// });

// app.get('/api/articles', async (req, res) => {
//   try{
//     const { category = 'news', q = '', cursor = '', limit = 10 } = req.query;
//     if(category !== 'news') return res.json({ items: [], nextCursor: null, total: 0 });
//     const start = cursor ? decodeCursor(cursor) : 0;
//     const pageNum = Math.floor(start / Number(limit)) + 1;
//     // primary: zh
//     let data;
//     if (newsapi) {
//       data = await newsapi.v2.everything({ q: (q || '头条').toString(), page: pageNum, pageSize: Number(limit), sortBy: 'publishedAt'});
//     } else {
//       const url = `https://newsapi.org/v2/everything?${new URLSearchParams({ q: (q || '头条').toString(), page: String(pageNum), pageSize: String(limit), sortBy: 'publishedAt', apiKey: NEWS_API_KEY }).toString()}`;
//       data = await httpJSON(url);
//     }
//     let items = (data.articles || []).map((n, idx) => ({
//       id: `news_${pageNum}_${idx}`,
//       title: n.title,
//       summary: n.description,
//       cover: n.urlToImage,
//       category: 'news',
//       publishedAt: n.publishedAt,
//       likes: 0,
//       url: n.url,
//       source: n.source?.name || ''
//     }));
//     if (!items.length) {
//       // fallback without language constraint and broader query
//       if (newsapi) {
//         data = await newsapi.v2.everything({ q: (q || 'top news').toString(), page: pageNum, pageSize: Number(limit), sortBy: 'publishedAt' });
//       } else {
//         const url = `https://newsapi.org/v2/everything?${new URLSearchParams({ q: (q || 'top news').toString(), page: String(pageNum), pageSize: String(limit), sortBy: 'publishedAt', apiKey: NEWS_API_KEY }).toString()}`;
//         data = await httpJSON(url);
//       }
//       items = (data.articles || []).map((n, idx) => ({
//         id: `news_${pageNum}_${idx}`,
//         title: n.title,
//         summary: n.description,
//         cover: n.urlToImage,
//         category: 'news',
//         publishedAt: n.publishedAt,
//         likes: 0,
//         url: n.url,
//         source: n.source?.name || ''
//       }));
//     }
//     const nextCursor = items.length < Number(limit) ? null : encodeCursor(start + items.length);
//     res.json({ items, nextCursor, total: data.totalResults || 0 });
//   }catch(e){
//     return logAnd500(res, 'articles', e);
//   }
// });

// app.get('/api/articles/:id', (req, res) => {
//   return res.status(404).json({ error: 'Not found' });
// });

// app.get('/api/trending', async (req, res) => {
//   try{
//     // primary: zh popularity
//     let data = newsapi ? await newsapi.v2.everything({ q: '热点 OR 热点新闻', sortBy: 'popularity', pageSize: 10 })
//       : await httpJSON(`https://newsapi.org/v2/everything?${new URLSearchParams({ q: '热点 OR 热点新闻', sortBy: 'popularity', pageSize: '10', apiKey: NEWS_API_KEY }).toString()}`);
//     if ((data.articles || []).length) {
//       const items = data.articles.map((n, idx) => ({ id: `news_tr_${idx}`, title: n.title, likes: 0, url: n.url }));
//       return res.json({ items });
//     }
//     // fallback: top-headlines general
//     data = newsapi ? await newsapi.v2.topHeadlines({ country: 'us', category: 'general', pageSize: 10 })
//       : await httpJSON(`https://newsapi.org/v2/top-headlines?${new URLSearchParams({ country: 'us', category: 'general', pageSize: '10', apiKey: NEWS_API_KEY }).toString()}`);
//     const items = (data.articles || []).map((n, idx) => ({ id: `news_tr_${idx}`, title: n.title, likes: 0, url: n.url }));
//     return res.json({ items });
//   }catch(e){
//     return logAnd500(res, 'trending', e);
//   }
// });

// // NewsAPI proxy: /api/news?q=keyword&page=1&pageSize=10
// app.get('/api/news', async (req, res) => {
//   try {
//     const { q = 'china', page = 1, pageSize = 10 } = req.query;
//     let data = newsapi ? await newsapi.v2.everything({ q: q.toString(), page, pageSize, sortBy: 'publishedAt'})
//       : await (await fetch(`https://newsapi.org/v2/everything?${new URLSearchParams({ q: q.toString(), page: String(page), pageSize: String(pageSize), sortBy: 'publishedAt', apiKey: NEWS_API_KEY }).toString()}`)).json();
//     let items = (data.articles || []).map((n, idx) => ({
//       id: `news_${Date.now()}_${idx}`,
//       title: n.title,
//       summary: n.description,
//       cover: n.urlToImage,
//       category: 'news',
//       publishedAt: n.publishedAt,
//       likes: 0,
//       content: `${n.source?.name || ''}  ${n.url || ''}`
//     }));
//     if (!items.length) {
//       // fallback: broaden query & remove language limit
//       data = newsapi ? await newsapi.v2.everything({ q: (q || 'top news').toString(), page, pageSize, sortBy: 'publishedAt' })
//         : await (await fetch(`https://newsapi.org/v2/everything?${new URLSearchParams({ q: (q || 'top news').toString(), page: String(page), pageSize: String(pageSize), sortBy: 'publishedAt', apiKey: NEWS_API_KEY }).toString()}`)).json();
//       items = (data.articles || []).map((n, idx) => ({
//         id: `news_${Date.now()}_${idx}`,
//         title: n.title,
//         summary: n.description,
//         cover: n.urlToImage,
//         category: 'news',
//         publishedAt: n.publishedAt,
//         likes: 0,
//         content: `${n.source?.name || ''}  ${n.url || ''}`
//       }));
//     }
//     res.json({ items, totalResults: data.totalResults || 0 });
//   } catch (e) {
//     return logAnd500(res, 'news', e);
//   }
// });

// app.post('/api/articles/:id/like', (req, res) => {
//   return res.status(400).json({ error: 'Like is not supported for external news.' });
// });

// // Fallback to SPA
// app.get('*', (req, res) => {
//   res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
// });

// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));


import express from 'express';
import path from 'path';
import morgan from 'morgan';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(morgan('dev'));

const PUBLIC_DIR = path.join(__dirname, 'public');
const NEWS_API_KEY = process.env.NEWS_API_KEY || '94a9a8ccb60445889de205f2c11a0f6f';
const PROXY_URL = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';

function logAnd500(res, tag, err) {
  console.error(`[${tag}]`, err && (err.stack || err.message || err));
  return res.status(500).json({ error: String(err && (err.message || err)), tag });
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

// --- Routes ---
app.get('/api/categories', (req, res) => {
  res.json({ categories: [{ id: 'news', name: '科技资讯' }] });
});

// ✅ /api/news 从 TechCrunch + TheNextWeb 获取
app.get('/api/news', async (req, res) => {
  try {
    const { q = '', page = 1, pageSize = 10 } = req.query;
    const url = `https://newsapi.org/v2/everything?${new URLSearchParams({
      domains: 'techcrunch.com,thenextweb.com',
      q: q || 'technology',
      page: String(page),
      pageSize: String(pageSize),
      sortBy: 'publishedAt',
      apiKey: NEWS_API_KEY
    }).toString()}`;
    const data = await httpJSON(url);
    const items = (data.articles || []).map((n, idx) => ({
      id: `news_${Date.now()}_${idx}`,
      title: n.title,
      summary: n.description,
      cover: n.urlToImage,
      category: 'news',
      publishedAt: n.publishedAt,
      likes: 0,
      content: `${n.source?.name || ''} ${n.url || ''}`
    }));
    res.json({ items, totalResults: data.totalResults || 0 });
  } catch (e) {
    return logAnd500(res, 'news', e);
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
    const items = (data.articles || []).map((n, idx) => ({
      id: `trend_${idx}`,
      title: n.title,
      url: n.url
    }));
    res.json({ items });
  } catch (e) {
    return logAnd500(res, 'trending', e);
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
