const tabs = document.getElementById('tabs');
const feed = document.getElementById('feed');
const trending = document.getElementById('trending');
const searchForm = document.getElementById('searchForm');
const qInput = document.getElementById('q');
const cardTpl = document.getElementById('cardTpl');
const userInfo = document.getElementById('userInfo');

// Cached DOM refs (initialized after DOM ready)
let feedEmptyEl = null;
let trendingEmptyEl = null;
let loaderEl = null;
let noMoreEl = null;

function waitForDOM(){
  return new Promise((resolve) => {
    if (document.readyState === 'complete' || document.readyState === 'interactive') return resolve();
    document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
  });
}

function initDOMRefs(){
  feedEmptyEl = document.getElementById('feedEmpty');
  trendingEmptyEl = document.getElementById('trendingEmpty');
  loaderEl = document.getElementById('loader');
  noMoreEl = document.getElementById('noMore');
}

let currentUser = localStorage.getItem('username') || '';

let state = {
  category: 'news',
  q: '',
  page: 1,
  busy: false,
  eof: false
};

async function fetchJSON(url, opts){
  const res = await fetch(url, opts);
  if(!res.ok) throw new Error(await res.text());
  return res.json();
}

function timeFromNow(iso){
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime())/1000;
  if(diff < 60) return `${Math.floor(diff)}秒前`;
  if(diff < 3600) return `${Math.floor(diff/60)}分钟前`;
  if(diff < 86400) return `${Math.floor(diff/3600)}小时前`;
  return d.toLocaleString();
}

function renderTabs(categories){
  tabs.innerHTML = '';
  categories.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'tab' + (state.category === c.id ? ' active' : '');
    btn.textContent = c.name;
    btn.dataset.id = c.id;
    btn.onclick = () => switchCategory(c.id);
    tabs.appendChild(btn);
  });
}

function makeCard(a){
  const node = cardTpl.content.firstElementChild.cloneNode(true);
  // set stable data-id for easy lookup
  try { node.setAttribute('data-id', a.id || ''); } catch(e){}
  const coverEl = node.querySelector('.cover');
  if (a.cover) {
    coverEl.src = a.cover;
    coverEl.classList.remove('placeholder');
  } else {
    // use placeholder styling
    coverEl.src = '';
    coverEl.classList.add('placeholder');
  }
  const catNode = node.querySelector('.cat');
  if (catNode) {
    catNode.textContent = (a.category || '').toUpperCase();
    // set class for color mapping
    const cls = (a.category || '').toLowerCase();
    catNode.className = 'cat ' + cls;
  }
  node.querySelector('.title').textContent = a.title;
  node.querySelector('.summary').textContent = a.summary || '';
  node.querySelector('.time').textContent = timeFromNow(a.publishedAt);
  node.querySelector('.likes').textContent = a.likes || 0;
  const open = () => {
    openDetail(a.id);
  };
  node.querySelector('.cover').onclick = open;
  node.querySelector('.title').onclick = open;

  // 点赞逻辑
  node.querySelector('.like').onclick = async () => {
    if (!currentUser) {
      alert('请先登录！');
      return;
    }
    try {
      const r = await fetchJSON(`/api/articles/${encodeURIComponent(a.id)}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser })
      });
      node.querySelector('.likes').textContent = r.likes;
    } catch (e) {
      alert('点赞失败：' + e.message);
    }
  };
  const cbtn = node.querySelector('.comment-btn');
  if (cbtn) {
    cbtn.onclick = () => {
      openDetail(a.id).then(() => {
        const ta = document.getElementById('commentText');
        if (ta) ta.focus();
      }).catch(() => {});
    };
  }
  return node;

}

async function loadMore(){
  if(state.busy || state.eof) return;
  state.busy = true;
  // show loader
  if (loaderEl) loaderEl.style.display = 'flex';
  if (noMoreEl) noMoreEl.style.display = 'none';
  // unified news endpoint: pass category + page + q
  try {
    const params = new URLSearchParams({ category: state.category, q: state.q || '', page: state.page, pageSize: 10 });
    const data = await fetchJSON(`/api/news?${params}`);
    const items = data.items || [];
    items.forEach(a => feed.appendChild(makeCard(a)));
    // increment page for next load
    if (items.length > 0) state.page = Number(state.page) + 1;
    state.eof = items.length < 10;
  } catch (e) {
    console.error('loadMore failed', e);
    state.eof = true;
  }
  state.busy = false;
  if (loaderEl) loaderEl.style.display = 'none';
  if (state.eof && noMoreEl) noMoreEl.style.display = 'block';
}

async function init(){
  console.log('[app] init start');
  await waitForDOM();
  initDOMRefs();
  updateUserUI();

  const showInitError = (msg) => {
    console.error('[app] init error:', msg);
    let el = document.getElementById('initError');
    if (!el) {
      el = document.createElement('div');
      el.id = 'initError';
      el.style.cssText = 'background:#fee;border:1px solid #f99;padding:10px;margin:10px;border-radius:6px;color:#900;max-width:1200px;margin-left:auto;margin-right:auto;';
      document.body.insertBefore(el, document.querySelector('.topbar')?.nextSibling || document.body.firstChild);
    }
    el.textContent = msg;
  };

  try {
    const cats = await fetchJSON('/api/categories');
    const categories = cats.categories; // now only news
    renderTabs(categories);
  } catch (e) {
    showInitError('加载分类失败：' + (e && e.message ? e.message : e));
    return;
  }

  try {
    await refresh();
  } catch (e) {
    showInitError('加载文章失败：' + (e && e.message ? e.message : e));
    return;
  }

  try {
    // ensure feed loads first before rendering trending
    await renderTrending();
  } catch (e) {
    // don't block app if trending fails, just log
    console.error('[app] renderTrending failed:', e);
  }

  console.log('[app] init done', { category: state.category, page: state.page });
  // infinite scroll
  window.addEventListener('scroll', () => {
    const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 200;
    if(nearBottom) loadMore();
  });
}

async function refresh(){
  feed.innerHTML = '';
  if (feedEmptyEl) {
    feedEmptyEl.style.display = 'none';
  } else {
    console.warn('[app] refresh: #feedEmpty not found in DOM (cached ref is null)');
  }
  state.page = 1;
  state.eof = false;
  await loadMore();
  if(!feed.children.length){
    if (feedEmptyEl) feedEmptyEl.style.display = 'block';
    else console.warn('[app] refresh: cannot show feedEmpty because cached ref is null');
  }
}

async function switchCategory(cat){
  state.category = cat;
  // update active
  [...tabs.children].forEach((el) => {
    el.classList.toggle('active', el.dataset.id === cat);
  });
  // reset paging when switching
  state.page = 1;
  state.eof = false;
  refresh();
}

searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  state.q = qInput.value.trim();
  refresh();
});

// 登录/注册显示
function updateUserUI() {
  userInfo.innerHTML = currentUser
    ? `👤 ${currentUser} <button id="logoutBtn">退出</button>`
    : `<button id="loginBtn">登录</button> / <button id="regBtn">注册</button>`;

  if (currentUser) {
    document.getElementById('logoutBtn').onclick = () => {
      localStorage.removeItem('username');
      currentUser = '';
      updateUserUI();
    };
  } else {
    document.getElementById('loginBtn').onclick = showLogin;
    document.getElementById('regBtn').onclick = showRegister;
  }
}

// 登录
async function showLogin() {
  const username = prompt('用户名：');
  const password = prompt('密码：');
  if (!username || !password) return;
  try {
    const r = await fetchJSON('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    localStorage.setItem('username', r.username);
    currentUser = r.username;
    alert('登录成功');
    updateUserUI();
  } catch (e) {
    alert('登录失败');
  }
}

// 注册
async function showRegister() {
  const username = prompt('注册用户名：');
  const password = prompt('密码：');
  if (!username || !password) return;
  try {
    await fetchJSON('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    alert('注册成功，请登录');
  } catch (e) {
    alert('注册失败');
  }
}

async function renderTrending(){
  // wait until feed has at least one article (avoid showing trending sample before feed)
  const waitForFeedItem = (timeoutMs = 3000) => new Promise((resolve) => {
    const interval = 150;
    const max = Math.ceil(timeoutMs / interval);
    let i = 0;
    const t = setInterval(() => {
      if (feed.children && feed.children.length > 0) {
        clearInterval(t);
        resolve(true);
        return;
      }
      i++;
      if (i >= max) {
        clearInterval(t);
        resolve(false);
      }
    }, interval);
  });

  const ready = await waitForFeedItem(3000);
  if (!ready) {
    console.log('[app] renderTrending skipped: feed empty after wait');
    return;
  }

  try {
    const { items } = await fetchJSON('/api/trending');
    trending.innerHTML = '';
  if (trendingEmptyEl) trendingEmptyEl.style.display = 'none';
    if(!items || !items.length){
      if (trendingEmptyEl) trendingEmptyEl.style.display = 'block';
      return;
    }
    items.forEach(a => {
      const li = document.createElement('li');
      li.className = 'trend-item';
      const title = document.createElement('a');
      title.href = '#';
      title.className = 'trend-link';
      title.textContent = a.title;
      title.dataset.id = a.id;
      title.onclick = (e) => { e.preventDefault(); if (a.url) window.open(a.url, '_blank'); };

      const actions = document.createElement('div');
      actions.className = 'trend-actions';

      const likeBtn = document.createElement('button');
      likeBtn.className = 'trend-like';
      likeBtn.innerHTML = `❤ <span class="trend-likes">${a.likes || 0}</span>`;
      likeBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!currentUser) {
          alert('请先登录！');
          return;
        }
        try {
          const r = await fetchJSON(`/api/articles/${encodeURIComponent(a.id)}/like`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: currentUser })
          });
          likeBtn.querySelector('.trend-likes').textContent = r.likes;
          likeBtn.classList.toggle('liked', !!r.liked);
        } catch (err) {
          alert('点赞失败：' + (err.message || err));
        }
      };

      actions.appendChild(likeBtn);
      li.appendChild(title);
      li.appendChild(actions);
      trending.appendChild(li);
    });
  } catch (e) {
    console.error('renderTrending failed', e);
  }
}

async function openDetail(id){
  // show modal
  const modal = document.getElementById('articleModal');
  const modalCover = document.getElementById('modalCover');
  const modalTitle = document.getElementById('modalTitle');
  const modalMeta = document.getElementById('modalMeta');
  const modalSummary = document.getElementById('modalSummary');
  const openOriginal = document.getElementById('openOriginal');
  const commentList = document.getElementById('commentList');
  const commentText = document.getElementById('commentText');
  const submitComment = document.getElementById('submitComment');

  try {
    const a = await fetchJSON(`/api/articles/${encodeURIComponent(id)}`);
    modalCover.src = a.cover || '';
    // modal like button
    let modalLike = document.getElementById('modalLike');
    if (!modalLike) {
      modalLike = document.createElement('button');
      modalLike.id = 'modalLike';
      modalLike.className = 'btn';
      modalLike.textContent = `❤ ${a.likes || 0}`;
      const actionsWrap = document.querySelector('.modal-actions');
      if (actionsWrap) actionsWrap.insertBefore(modalLike, actionsWrap.firstChild || null);
    } else {
      modalLike.textContent = `❤ ${a.likes || 0}`;
    }
    modalLike.onclick = async () => {
      if (!currentUser) { alert('请先登录'); return; }
      try {
        modalLike.disabled = true;
        const r = await fetchJSON(`/api/articles/${encodeURIComponent(id)}/like`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: currentUser })
        });
        modalLike.textContent = `❤ ${r.likes}`;
        // sync with card in feed using data-id
        const card = document.querySelector(`.card[data-id="${id}"]`);
        if (card) {
          const likesEl = card.querySelector('.likes');
          if (likesEl) likesEl.textContent = r.likes;
        }
      } catch (e) {
        alert('点赞失败：' + (e.message || e));
      } finally { modalLike.disabled = false; }
    };
    modalTitle.textContent = a.title || '';
    modalMeta.textContent = `${a.source || ''} · ${a.publishedAt ? new Date(a.publishedAt).toLocaleString() : ''} · ${a.likes || 0}❤`;
    modalSummary.textContent = a.summary || '';
    if (a.url) {
      openOriginal.href = a.url;
      openOriginal.style.display = 'inline-block';
    } else {
      openOriginal.style.display = 'none';
    }

  // load comments
    commentList.innerHTML = '<li class="comment-item">加载中...</li>';
    try {
      // include currentUser so server can mark which comments are liked by this user
      const cc = await fetchJSON(`/api/articles/${encodeURIComponent(id)}/comments${currentUser ? `?username=${encodeURIComponent(currentUser)}` : ''}`);
      const items = cc.items || [];
      if (!items.length) {
        commentList.innerHTML = '<li class="comment-item">暂无评论</li>';
      } else {
        commentList.innerHTML = items.map(it => {
          const likedCls = it.liked ? 'comment-liked' : '';
          const likes = it.likes || 0;
          return `
            <li class="comment-item" data-comment-id="${it.id}">
              <div class="comment-meta">${it.username} · ${new Date(it.createdAt).toLocaleString()}</div>
              <div class="comment-text">${escapeHtml(it.text)}</div>
              <div class="comment-row" style="margin-top:8px;display:flex;align-items:center;gap:8px">
                <button class="btn comment-like ${likedCls}" data-comment-id="${it.id}">❤ <span class="c-likes">${likes}</span></button>
              </div>
            </li>`;
        }).join('');
      }
    } catch (e) {
      commentList.innerHTML = '<li class="comment-item">加载评论失败</li>';
    }

    // auth hint in modal
    const modalAuth = document.getElementById('modalAuth');
    if (modalAuth) {
      if (!currentUser) {
        modalAuth.style.display = 'inline-block';
        modalAuth.innerHTML = `<button id="modalLoginBtn" class="btn">登录以发表评论</button>`;
        document.getElementById('modalLoginBtn').onclick = async () => {
          await showLogin();
          // after login, update UI
          if (currentUser) {
            modalAuth.style.display = 'none';
          }
        };
      } else {
        modalAuth.style.display = 'none';
      }
    }

    // ensure comment column visible when modal opens (scroll its inner list)
    setTimeout(() => {
      const commentsCol = document.querySelector('.comments-column');
      if (commentsCol) {
        // scroll to top of comments column so user sees comment area
        commentsCol.scrollTop = 0;
      }
    }, 120);

    // when textarea focused, scroll it into view
    commentText.onfocus = () => {
      setTimeout(()=>{
        const commentsCol = document.querySelector('.comments-column');
        if (commentsCol) {
          // scroll to bottom so textarea and submit button visible
          commentsCol.scrollTop = commentsCol.scrollHeight;
        }
      }, 100);
    };

    // submit comment
    submitComment.onclick = async () => {
      if (!currentUser) { alert('请先登录'); return; }
      const txt = commentText.value.trim();
      if (!txt) { alert('评论不能为空'); return; }
      if (txt.length > 300) { alert('评论不能超过 300 字'); return; }
      try {
        submitComment.disabled = true;
        submitComment.textContent = '提交中...';
        const r = await fetchJSON(`/api/articles/${encodeURIComponent(id)}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: currentUser, text: txt })
        });
        // append comment to list
        const it = r.comment;
  const node = document.createElement('li');
  node.className = 'comment-item';
  node.setAttribute('data-comment-id', it.id);
  node.innerHTML = `<div class="comment-meta">${it.username} · ${new Date(it.createdAt).toLocaleString()}</div><div class="comment-text">${escapeHtml(it.text)}</div><div class="comment-row" style="margin-top:8px;display:flex;align-items:center;gap:8px"><button class="btn comment-like" data-comment-id="${it.id}">❤ <span class="c-likes">0</span></button></div>`;
        if (commentList.querySelector('.comment-item') && commentList.children.length === 1 && commentList.children[0].textContent === '暂无评论') {
          commentList.innerHTML = '';
        }
        commentList.insertBefore(node, commentList.firstChild);
        commentText.value = '';
        // attach click handler to newly added comment-like button
        const newLikeBtn = node.querySelector('.comment-like');
        if (newLikeBtn) newLikeBtn.onclick = commentLikeHandler(id);
      } catch (e) {
        alert('发表评论失败：' + (e.message || e));
      } finally {
        submitComment.disabled = false;
        submitComment.textContent = '发表评论';
      }
    };

    // attach like handlers for existing comment buttons
    const likeBtns = commentList.querySelectorAll('.comment-like');
    likeBtns.forEach(btn => { btn.onclick = commentLikeHandler(id); });

    // show
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
  // inline comment button will be displayed next to textarea

  } catch (e) {
    alert('打开文章失败：' + (e.message || e));
  }
}

// modal handlers
function closeModal(){
  const modal = document.getElementById('articleModal');
  if (!modal) return;
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
  // remove fixed class
  const ca = document.querySelector('.comment-actions');
  if (ca) ca.classList.remove('comment-fixed');
}

function escapeHtml(s){
  if(!s) return '';
  return s.replace(/[&<>\"]/g, (c)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c] || c));
}

// returns a click handler bound to article id
function commentLikeHandler(articleId){
  return async function(e){
    e.preventDefault();
    const btn = e.currentTarget;
    const commentId = btn.dataset.commentId;
    if (!currentUser) { alert('请先登录'); return; }
    try {
      btn.disabled = true;
      const r = await fetchJSON(`/api/articles/${encodeURIComponent(articleId)}/comments/${encodeURIComponent(commentId)}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser })
      });
      const likesSpan = btn.querySelector('.c-likes');
      if (likesSpan) likesSpan.textContent = r.likes;
      btn.classList.toggle('comment-liked', !!r.liked);
    } catch (err) {
      alert('操作失败：' + (err.message || err));
    } finally {
      btn.disabled = false;
    }
  };
}

// attach modal event listeners after DOM ready
waitForDOM().then(() => {
  const modal = document.getElementById('articleModal');
  if (!modal) return;
  const closeBtn = document.getElementById('modalClose');
  const backdrop = modal.querySelector('.modal-backdrop');
  closeBtn.onclick = closeModal;
  backdrop.onclick = closeModal;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
});

init().catch(err => {
  console.error(err);
  alert('初始化失败');
});

// expose some helpers for debugging in browser console
try{
  window.__app = {
    state,
    refresh,
    switchCategory,
    loadMore,
  };
  console.log('[app] debug helpers attached: window.__app');
}catch(e){/* ignore when no window */}


