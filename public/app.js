const tabs = document.getElementById('tabs');
const feed = document.getElementById('feed');
const trending = document.getElementById('trending');
const searchForm = document.getElementById('searchForm');
const qInput = document.getElementById('q');
const cardTpl = document.getElementById('cardTpl');

let state = {
  category: 'news',
  q: '',
  cursor: '',
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
  node.querySelector('.cover').src = a.cover;
  node.querySelector('.title').textContent = a.title;
  node.querySelector('.summary').textContent = a.summary || '';
  node.querySelector('.time').textContent = timeFromNow(a.publishedAt);
  node.querySelector('.likes').textContent = a.likes || 0;
  const open = () => {
    if(a.url){ window.open(a.url, '_blank'); }
    else openDetail(a.id);
  };
  node.querySelector('.title').onclick = open;
  node.querySelector('.cover').onclick = open;
  node.querySelector('.like').onclick = async () => {
    if(a.category === 'news'){ alert('外部资讯不支持点赞'); return; }
    try{
      const r = await fetchJSON(`/api/articles/${a.id}/like`, { method: 'POST' });
      node.querySelector('.likes').textContent = r.likes;
    }catch(e){ alert('点赞失败'); }
  };
  return node;
}

async function loadMore(){
  if(state.busy || state.eof) return;
  state.busy = true;
  if(state.category === 'news'){
    const pageNum = state.cursor ? (Number(atob(state.cursor)) / 10) + 1 : 1;
    const params = new URLSearchParams({ q: state.q || '头条', page: pageNum, pageSize: 10 });
    const data = await fetchJSON(`/api/news?${params}`);
    data.items.forEach(a => feed.appendChild(makeCard(a)));
    const nextIndex = (state.cursor ? Number(atob(state.cursor)) : 0) + data.items.length;
    state.cursor = data.items.length < 10 ? '' : btoa(String(nextIndex));
    state.eof = data.items.length < 10;
  } else {
    const params = new URLSearchParams({ category: state.category, q: state.q, cursor: state.cursor, limit: 10 });
    const page = await fetchJSON(`/api/articles?${params}`);
    page.items.forEach(a => feed.appendChild(makeCard(a)));
    state.cursor = page.nextCursor || '';
    state.eof = !page.nextCursor;
  }
  state.busy = false;
}

async function init(){
  const cats = await fetchJSON('/api/categories');
  const categories = cats.categories; // now only news
  renderTabs(categories);
  refresh();
  renderTrending();
  // infinite scroll
  window.addEventListener('scroll', () => {
    const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 200;
    if(nearBottom) loadMore();
  });
}

async function refresh(){
  feed.innerHTML = '';
  document.getElementById('feedEmpty').style.display = 'none';
  state.cursor = '';
  state.eof = false;
  await loadMore();
  if(!feed.children.length){
    document.getElementById('feedEmpty').style.display = 'block';
  }
}

async function switchCategory(cat){
  state.category = cat;
  // update active
  [...tabs.children].forEach((el) => {
    el.classList.toggle('active', el.dataset.id === cat);
  });
  refresh();
}

searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  state.q = qInput.value.trim();
  refresh();
});

async function renderTrending(){
  const { items } = await fetchJSON('/api/trending');
  trending.innerHTML = '';
  const empty = document.getElementById('trendingEmpty');
  empty.style.display = 'none';
  if(!items || !items.length){
    empty.style.display = 'block';
    return;
  }
  items.forEach(a => {
    const li = document.createElement('li');
    li.innerHTML = `<a href="#" data-id="${a.id}">${a.title}</a>`;
    li.querySelector('a').onclick = (e) => { e.preventDefault(); if(a.url) window.open(a.url, '_blank'); };
    trending.appendChild(li);
  });
}

async function openDetail(id){
  const a = await fetchJSON(`/api/articles/${id}`);
  alert(`${a.title}\n\n${a.content || ''}`);
}

init().catch(err => {
  console.error(err);
  alert('初始化失败');
});


