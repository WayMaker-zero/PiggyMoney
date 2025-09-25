// --- Routing ---
const routes = { '/': overview, '/new': newTx, '/stats': stats, '/search': search, '/settings': settings, '/auth': auth };
function mount() { window.addEventListener('hashchange', render); render(); }
function render() {
  const hash = location.hash.replace('#', '') || '/';
  const view = document.getElementById('view');
  (routes[hash] || notfound)(view);
  updateActiveNav(hash);
}

// --- DB Layer (IndexedDB minimal) ---
const DB_NAME = 'piggy-money';
const DB_VERSION = 1;
function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('users')) db.createObjectStore('users', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('ledger')) db.createObjectStore('ledger', { keyPath: 'userId' });
      if (!db.objectStoreNames.contains('transactions')){
        const s = db.createObjectStore('transactions', { keyPath: 'id' });
        s.createIndex('userId', 'userId', { unique: false });
        s.createIndex('userId_date', ['userId','date'], { unique: false });
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function tx(stores, mode, fn){
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    t.oncomplete = () => {};
    t.onerror = () => reject(t.error);
    Promise.resolve(fn(t)).then(resolve, reject);
  }));
}
const reqAsync = (req) => new Promise((res, rej)=>{ req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error); });
const getAll = (store) => 'getAll' in store ? reqAsync(store.getAll()) : new Promise((res, rej)=>{ const out=[]; const c=store.openCursor(); c.onsuccess=()=>{ const cur=c.result; if(!cur) return res(out); out.push(cur.value); cur.continue();}; c.onerror=()=>rej(c.error);});
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random()*16|0; const v = c==='x'?r:(r&0x3)|0x8; return v.toString(16); });

async function getCurrentUser(){
  return tx(['meta','users'], 'readonly', async (t)=>{
    const id = await reqAsync(t.objectStore('meta').get('currentUserId')).then(r=>r?.value);
    if (!id) return null;
    return await reqAsync(t.objectStore('users').get(id));
  });
}
async function register(username){
  const user = { id: uuid(), username, createdAt: Date.now() };
  await tx(['users','meta'], 'readwrite', async (t)=>{
    await reqAsync(t.objectStore('users').add(user));
    await reqAsync(t.objectStore('meta').put({ key: 'currentUserId', value: user.id }));
  });
  return user;
}
async function login(username){
  return tx(['users','meta'], 'readwrite', async (t)=>{
    const all = await getAll(t.objectStore('users'));
    const found = all.find(u=>u.username===username);
    if (!found) throw new Error('用户不存在');
    await reqAsync(t.objectStore('meta').put({ key: 'currentUserId', value: found.id }));
    return found;
  });
}
async function logout(){ await tx(['meta'],'readwrite', async (t)=>{ await reqAsync(t.objectStore('meta').delete('currentUserId')); }); }
async function getInitialBalance(userId){ return tx(['ledger'],'readonly', async (t)=>{ const r = await reqAsync(t.objectStore('ledger').get(userId)); return r?.initialBalance ?? null; }); }
async function setInitialBalance(userId, amount){ return tx(['ledger'],'readwrite', async (t)=>{ await reqAsync(t.objectStore('ledger').put({ userId, initialBalance: amount, createdAt: Date.now() })); }); }
async function addTransaction(txn){ if(!txn.id) txn.id=uuid(); return tx(['transactions'],'readwrite', async (t)=>{ await reqAsync(t.objectStore('transactions').add(txn)); }); }
async function updateTransaction(txn){ return tx(['transactions'],'readwrite', async (t)=>{ await reqAsync(t.objectStore('transactions').put(txn)); }); }
async function removeTransaction(id){ return tx(['transactions'],'readwrite', async (t)=>{ await reqAsync(t.objectStore('transactions').delete(id)); }); }
async function listTransactions(filter){ return tx(['transactions'],'readonly', async (t)=>{ let list = await getAll(t.objectStore('transactions')); if(filter?.userId) list=list.filter(x=>x.userId===filter.userId); if(filter?.range) list=list.filter(x=>x.date>=filter.range.start && x.date<=filter.range.end); if(filter?.type) list=list.filter(x=>x.type===filter.type); list.sort((a,b)=>a.date.localeCompare(b.date)); return list; }); }

async function exportJson(userId, opts={ encrypted:false, password:'' }){
  const [users, ledger, transactions, meta] = await tx(['users','ledger','transactions','meta'],'readonly', async (t)=>{
    const users = await getAll(t.objectStore('users'));
    const ledger = await getAll(t.objectStore('ledger'));
    const transactions = await getAll(t.objectStore('transactions'));
    const meta = await getAll(t.objectStore('meta'));
    return [users, ledger, transactions, meta];
  });
  const payload = { version: 1, exportedAt: new Date().toISOString(), userId, users, ledger, transactions, meta };
  let blob;
  if (opts.encrypted && opts.password) {
    const enc = await encryptBlob(new Blob([JSON.stringify(payload)]), opts.password);
    blob = new Blob([enc], { type: 'application/octet-stream' });
  } else {
    blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ext = opts.encrypted ? 'pmj' : 'json';
  a.href = url; a.download = `piggy-${Date.now()}.${ext}`; a.click();
  URL.revokeObjectURL(url);
}

async function importJson(file, opts={ strategy:'overwrite', password:'' }){
  const buf = await file.arrayBuffer();
  let text;
  if (file.name.endsWith('.pmj')) {
    if (!opts.password) throw new Error('需要口令解密');
    const plain = await decryptBytes(new Uint8Array(buf), opts.password);
    text = new TextDecoder().decode(plain);
  } else {
    text = new TextDecoder().decode(new Uint8Array(buf));
    if (!text.trim().startsWith('{')) {
      if (!opts.password) throw new Error('未识别的文件，如为加密导出请提供口令');
      const plain = await decryptBytes(new Uint8Array(buf), opts.password);
      text = new TextDecoder().decode(plain);
    }
  }
  const data = JSON.parse(text);
  if (!data || !data.version) throw new Error('文件格式不正确');
  if (opts.strategy === 'overwrite') {
    await tx(['users','ledger','transactions','meta'], 'readwrite', async (t)=>{
      for (const name of ['users','ledger','transactions','meta']) await clearStore(t.objectStore(name));
      await bulkPut(t.objectStore('users'), data.users||[]);
      await bulkPut(t.objectStore('ledger'), data.ledger||[]);
      await bulkPut(t.objectStore('transactions'), data.transactions||[]);
      await bulkPut(t.objectStore('meta'), data.meta||[]);
    });
  } else {
    await tx(['users','ledger','transactions','meta'], 'readwrite', async (t)=>{
      await mergeByKey(t.objectStore('users'), data.users||[], 'id');
      await mergeByKey(t.objectStore('ledger'), data.ledger||[], 'userId');
      await mergeByKey(t.objectStore('transactions'), data.transactions||[], 'id');
      await mergeByKey(t.objectStore('meta'), data.meta||[], 'key');
    });
  }
}

function clearStore(store){ return new Promise((res,rej)=>{ const r = store.clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); }
async function bulkPut(store, arr){ for (const it of arr){ await reqAsync(store.put(it)); } }
async function mergeByKey(store, arr, key){ const existing = await getAll(store); const map=new Map(existing.map(x=>[x[key], x])); for (const it of arr){ if (!map.has(it[key])) await reqAsync(store.put(it)); } }

// Crypto helpers (PBKDF2 + AES-GCM)
async function encryptBlob(blob, password){
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const data = new Uint8Array(await blob.arrayBuffer());
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, data));
  const MAGIC = new TextEncoder().encode('PMJ1');
  const out = new Uint8Array(MAGIC.length + salt.length + iv.length + cipher.length);
  out.set(MAGIC, 0); out.set(salt, MAGIC.length); out.set(iv, MAGIC.length+salt.length); out.set(cipher, MAGIC.length+salt.length+iv.length);
  return out;
}
async function decryptBytes(bytes, password){
  const MAGIC = new TextEncoder().encode('PMJ1');
  if (bytes.length < MAGIC.length+16+12) throw new Error('文件太短');
  if (!MAGIC.every((b,i)=>bytes[i]===b)) throw new Error('文件头不匹配');
  const salt = bytes.slice(MAGIC.length, MAGIC.length+16);
  const iv = bytes.slice(MAGIC.length+16, MAGIC.length+16+12);
  const cipher = bytes.slice(MAGIC.length+16+12);
  const key = await deriveKey(password, salt);
  const plain = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, cipher).catch(()=>{ throw new Error('口令不正确或文件损坏'); });
  return new Uint8Array(plain);
}
async function deriveKey(password, salt){
  const enc = new TextEncoder().encode(password);
  const base = await crypto.subtle.importKey('raw', enc, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name:'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' }, base, { name:'AES-GCM', length: 256 }, false, ['encrypt','decrypt']);
}

// --- Views ---
async function overview(root){
  const user = await getCurrentUser();
  const ui = [];
  ui.push('<div class="card">');
  ui.push('<h2>总览</h2>');
  if (!user){
    ui.push('<p>尚未登录。请先注册或登录。</p>');
    ui.push('<div class="row row-2"><a href="#/auth"><button>注册/登录</button></a><a href="#/stats"><button>统计</button></a></div>');
  } else {
    const bal = await getInitialBalance(user.id);
    ui.push(`<p>当前用户：<b>${user.username}</b></p>`);
    if (bal == null){
      ui.push('<p>尚未设置初始总余额。</p>');
      ui.push('<form id="initForm" class="row row-2"><input type="number" step="0.01" placeholder="初始总余额"><button type="submit">保存</button></form>');
    }
    ui.push('<div class="row row-2"><a href="#/new"><button>记一笔</button></a><a href="#/stats"><button>查看统计</button></a></div>');
    ui.push('<div class="row" style="margin-top:12px"><button id="btnLogout">登出</button></div>');
  }
  ui.push('</div>');
  root.innerHTML = ui.join('');
  if (user){
    const initForm = root.querySelector('#initForm');
    if (initForm){
      initForm.addEventListener('submit', async (e)=>{
        e.preventDefault();
        const val = parseFloat(initForm.querySelector('input').value);
        if (isNaN(val) || val < 0) return alert('请输入有效的金额');
        await setInitialBalance(user.id, val);
        render();
      });
    }
    root.querySelector('#btnLogout')?.addEventListener('click', async ()=>{ await logout(); render(); });
  }
}

async function auth(root){
  root.innerHTML = `
    <div class="card">
      <h2>注册 / 登录</h2>
      <div class="row row-2">
        <form id="regForm" class="row">
          <input name="username" placeholder="新用户名" required />
          <button type="submit">注册并登录</button>
        </form>
        <form id="loginForm" class="row">
          <input name="username" placeholder="用户名" required />
          <button type="submit">登录</button>
        </form>
      </div>
    </div>`;
  root.querySelector('#regForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const name = e.target.username.value.trim();
    if (!name) return;
    await register(name);
    location.hash = '#/';
  });
  root.querySelector('#loginForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const name = e.target.username.value.trim();
    if (!name) return;
    try { await login(name); location.hash = '#/'; }
    catch(err){ alert(err.message || '登录失败'); }
  });
}

async function newTx(root){
  const user = await getCurrentUser();
  if (!user){ root.innerHTML = '<div class="card"><p>请先前往注册/登录。</p><a href="#/auth"><button>前往</button></a></div>'; return; }
  const today = new Date().toISOString().slice(0,10);
  root.innerHTML = `
    <div class="card">
      <h2>记一笔</h2>
      <form id="txForm" class="row">
        <div class="row row-2">
          <select name="type"><option value="expense">支出</option><option value="income">收入</option></select>
          <input name="amount" type="number" step="0.01" placeholder="金额" required />
        </div>
        <div class="row row-2">
          <input name="date" type="date" value="${today}" required />
          <input name="note" placeholder="备注（可选）" />
        </div>
        <input name="tags" placeholder="标签，逗号分隔（可选）" />
        <button type="submit">保存</button>
      </form>
    </div>`;
  root.querySelector('#txForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const f = e.target;
    const amount = parseFloat(f.amount.value);
    if (isNaN(amount) || amount <= 0) return alert('请输入有效金额');
    const tags = String(f.tags?.value||'').split(',').map(s=>s.trim()).filter(Boolean);
    const tx = { id: '', userId: user.id, amount, type: f.type.value, date: f.date.value, note: f.note.value, tags };
    await addTransaction(tx);
    alert('已保存');
    location.hash = '#/stats';
  });
}

async function stats(root){
  const user = await getCurrentUser();
  if (!user){ root.innerHTML = '<div class="card"><p>请先登录后查看统计。</p></div>'; return; }
  const range = lastMonthsRange(6);
  const list = await listTransactions({ userId: user.id, range });
  const view = [];
  view.push('<div class="card">');
  view.push('<h2>统计</h2>');
  view.push('<div class="row row-2"><select id="kind"><option value="balance">余额</option><option value="income">收入</option><option value="expense">支出</option></select><select id="gran"><option value="month">按月</option><option value="week">按周</option></select></div>');
  view.push('<div class="chart" id="chart"></div>');
  view.push('<h3>最近记录</h3>');
  view.push('<div class="row row-2"><input id="q" placeholder="搜索备注/标签"/><span class="muted">共 '+list.length+' 条</span></div>');
  view.push('<div id="list"></div>');
  view.push('</div>');
  root.innerHTML = view.join('');
  const chartEl = root.querySelector('#chart');
  function update(){
    const kind = root.querySelector('#kind').value;
    const gran = root.querySelector('#gran').value;
    const data = aggregate(list, kind, gran);
    renderLine(chartEl, { name: kind, data });
  }
  root.querySelector('#kind').addEventListener('change', update);
  root.querySelector('#gran').addEventListener('change', update);
  update();
  const listEl = root.querySelector('#list');
  const qEl = root.querySelector('#q');
  function renderList(){
    const q = (qEl.value||'').toLowerCase();
    const rows = list.filter(x=> !q || (x.note||'').toLowerCase().includes(q) || (x.tags||[]).join(',').toLowerCase().includes(q))
      .slice(-20).reverse()
      .map(x=> `<div class="row" style=\"border-bottom:1px solid rgba(255,255,255,0.06); padding:8px 0;\">\n        <div>${x.date} · ${x.type==='income'?'+':'-'}${x.amount.toFixed(2)}</div>\n        <div class=\"muted\">${escapeHtml(x.note||'')}${x.tags&&x.tags.length? ' · #'+x.tags.map(escapeHtml).join(' #'):''}</div>\n      </div>`).join('');
    listEl.innerHTML = rows || '<p class="muted">暂无数据</p>';
  }
  qEl.addEventListener('input', renderList);
  renderList();
}

async function settings(root){
  const user = await getCurrentUser();
  const disabled = user ? '' : 'disabled';
  root.innerHTML = `
    <div class="card">
      <h2>设置</h2>
      <div class="row">
        <label class="muted">存储模式（占位）：
          <select id="storageMode">
            <option value="idb" selected>IndexedDB（默认）</option>
            <option value="sqlite">文件账本（SQLite WASM）</option>
          </select>
        </label>
      </div>
      <h3>备份与迁移</h3>
      <div class="row row-2">
        <div class="row">
          <label><input type="checkbox" id="encExport"> 使用口令加密导出</label>
          <input id="exportPwd" placeholder="导出口令（可选）" type="password" />
          <button id="btnExport" ${disabled}>导出</button>
        </div>
        <div class="row">
          <input id="importFile" type="file" accept=".json,.pmj" />
          <select id="strategy"><option value="overwrite">覆盖导入</option><option value="merge">合并导入</option></select>
          <input id="importPwd" placeholder="导入口令（如为加密文件）" type="password" />
          <button id="btnImport">导入</button>
        </div>
      </div>
      <div class="row">
        <button id="btnLogout" ${disabled}>登出</button>
      </div>
      <p class="muted" id="sqliteTip">说明：SQLite 需加载 sql.js 才能启用；未加载时请使用 JSON 备份/迁移。</p>
    </div>`;
  // Disable SQLite mode if sql.js not present
  const sqliteAvailable = typeof window.initSqlJs === 'function' || typeof window.SQL === 'object';
  if (!sqliteAvailable){
    const opt = root.querySelector('#storageMode option[value="sqlite"]');
    if (opt) { opt.disabled = true; }
    const tip = root.querySelector('#sqliteTip');
    if (tip) tip.textContent = '说明：未检测到 sql.js（SQLite WASM），请参考 DocsIgnore/SQLite依赖与集成计划.md 安装后启用。';
  }
  if (user){
    root.querySelector('#btnExport').addEventListener('click', async ()=>{
      const enc = root.querySelector('#encExport').checked;
      const pwd = root.querySelector('#exportPwd').value;
      await exportJson(user.id, { encrypted: enc && !!pwd, password: pwd });
    });
    root.querySelector('#btnImport').addEventListener('click', async ()=>{
      const f = root.querySelector('#importFile').files[0];
      if (!f) return alert('请选择文件');
      const strategy = root.querySelector('#strategy').value;
      const pwd = root.querySelector('#importPwd').value;
      try { await importJson(f, { strategy, password: pwd }); alert('导入成功'); } catch(err){ alert(err.message || '导入失败'); }
    });
    root.querySelector('#btnLogout').addEventListener('click', async ()=>{ await logout(); render(); });
  }
}

function notfound(root){ root.innerHTML = '<div class="card"><h2>未找到页面</h2></div>'; }

// --- Helpers: chart & aggregate ---
function renderLine(el, series){
  let canvas = el.querySelector('canvas');
  if (!canvas){ canvas = document.createElement('canvas'); canvas.style.width='100%'; canvas.style.height='100%'; el.innerHTML=''; el.appendChild(canvas); }
  const dpr = Math.min(window.devicePixelRatio||1, 2);
  const rect = el.getBoundingClientRect(); const w=Math.max(320, rect.width); const h=Math.max(160, rect.height);
  canvas.width = Math.floor(w*dpr); canvas.height = Math.floor(h*dpr);
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr); ctx.clearRect(0,0,w,h);
  const stats = calcSeriesStats(series.data);
  drawAxesWithLabels(ctx, w, h, series.data, stats);
  drawSeries(ctx, series.data, w, h, stats);
}
function calcSeriesStats(data){ if(!data.length) return { ymin:0, ymax:1 }; const vals=data.map(p=>p.y); const min=Math.min(...vals); const max=Math.max(...vals); const pad=(max-min)*.1||1; return { ymin: min-pad, ymax: max+pad }; }
function drawAxesWithLabels(ctx, w, h, data, st){ const L=40,R=w-10,T=10,B=h-30; ctx.strokeStyle='rgba(255,255,255,.15)'; ctx.lineWidth=1; // axes
  ctx.beginPath(); ctx.moveTo(L,B); ctx.lineTo(R,B); ctx.stroke(); ctx.beginPath(); ctx.moveTo(L,T); ctx.lineTo(L,B); ctx.stroke();
  ctx.fillStyle='rgba(223,232,255,.85)'; ctx.font='12px system-ui, -apple-system, Segoe UI, Roboto, Arial'; ctx.textAlign='right'; ctx.textBaseline='middle';
  const yticks = 4; for(let i=0;i<=yticks;i++){ const t=i/yticks; const y=B - t*(B-T); const v = st.ymin + t*(st.ymax-st.ymin); ctx.fillText(formatMoney(v), L-6, y); ctx.beginPath(); ctx.strokeStyle='rgba(255,255,255,.06)'; ctx.moveTo(L,y); ctx.lineTo(R,y); ctx.stroke(); }
  // x labels: first, mid, last
  ctx.textAlign='center'; ctx.textBaseline='top'; const n=data.length; if(n){ const xs=[0, Math.floor((n-1)/2), n-1]; const step=(R-L)/Math.max(1,n-1); xs.forEach((i,idx)=>{ const x=L + i*step; const label=String(data[i].x); ctx.fillStyle='rgba(223,232,255,.85)'; ctx.fillText(label, x, B+6); }); }
}
function drawSeries(ctx, data, w, h, st){ if(!data.length) return; const { ymin, ymax } = st; const L=40,R=w-10,T=10,B=h-30; const step=(R-L)/Math.max(1,data.length-1); const grad=ctx.createLinearGradient(0,T,0,B); grad.addColorStop(0,'rgba(138,180,255,0.5)'); grad.addColorStop(1,'rgba(138,180,255,0.05)'); ctx.fillStyle=grad; const pts=[]; data.forEach((p,i)=>{ const x=L+i*step; const y=B-((p.y-ymin)/(ymax-ymin))*(B-T); pts.push([x,y]);}); ctx.beginPath(); pts.forEach(([x,y],i)=>{ if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);}); ctx.strokeStyle='#8ab4ff'; ctx.lineWidth=2; ctx.stroke(); ctx.lineTo(R,B); ctx.lineTo(L,B); ctx.closePath(); ctx.globalAlpha=0.7; ctx.fill(); ctx.globalAlpha=1; }
function lastMonthsRange(n){ const now=new Date(); const end=now.toISOString().slice(0,10); const startDate= new Date(now); startDate.setMonth(now.getMonth()-n+1); const start=startDate.toISOString().slice(0,10); return { start, end }; }
function isoWeekKey(iso){ const d=new Date(iso+'T00:00:00Z'); const yStart=new Date(Date.UTC(d.getUTCFullYear(),0,1)); const day=(d.getUTCDay()+6)%7; const diff=(d.getTime()-yStart.getTime())/86400000+1; const week=Math.ceil((diff-day)/7); return `${d.getUTCFullYear()}-W${String(week).padStart(2,'0')}`; }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])); }
function aggregate(items, kind, gran){ const sorted=[...items].sort((a,b)=>a.date.localeCompare(b.date)); const map=new Map(); for(const t of sorted){ const key = gran==='week'? isoWeekKey(t.date): t.date.slice(0,7); const delta = t.type==='income'? t.amount: -t.amount; if(kind==='income'&&t.type!=='income') continue; if(kind==='expense'&&t.type!=='expense') continue; const v = kind==='balance'? delta: Math.abs(delta); map.set(key,(map.get(key)||0)+v);} const out=[...map.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([x,y])=>({x,y})); if(kind==='balance'){ let acc=0; for(const p of out){ acc+=p.y; p.y=acc; } } return out; }
function formatMoney(v){ const abs=Math.abs(v); const sign=v<0?'-':''; if(abs>=1e8) return sign+(abs/1e8).toFixed(1)+'亿'; if(abs>=1e4) return sign+(abs/1e4).toFixed(1)+'万'; return sign+abs.toFixed(0); }

// --- Search Page ---
async function search(root){
  const user = await getCurrentUser();
  if (!user){ root.innerHTML = '<div class="card"><p>请先登录后进行搜索。</p></div>'; return; }
  const today = new Date().toISOString().slice(0,10);
  const start30 = (()=>{ const d=new Date(); d.setDate(d.getDate()-30); return d.toISOString().slice(0,10); })();
  root.innerHTML = `
    <div class="card">
      <h2>搜索条目</h2>
      <div class="row row-2">
        <input id="kw" placeholder="关键词：备注或标签" />
        <div class="row row-2">
          <input id="start" type="date" value="${start30}" />
          <input id="end" type="date" value="${today}" />
        </div>
      </div>
      <div class="row"><button id="btnSearch">搜索</button></div>
      <div id="result"></div>
    </div>`;
  root.querySelector('#btnSearch').addEventListener('click', runSearch);
  await runSearch();

  async function runSearch(){
    const kw = root.querySelector('#kw').value.trim().toLowerCase();
    const start = root.querySelector('#start').value || '0000-01-01';
    const end = root.querySelector('#end').value || '9999-12-31';
    let list = await listTransactions({ userId: user.id, range: { start, end } });
    if (kw) list = list.filter(x => (x.note||'').toLowerCase().includes(kw) || (x.tags||[]).join(',').toLowerCase().includes(kw));
    renderList(list);
  }

  function renderList(list){
    const res = root.querySelector('#result');
    if (!list.length){ res.innerHTML = '<p class="muted">未找到匹配记录</p>'; return; }
    res.innerHTML = list.slice().reverse().map(item => rowHtml(item)).join('');
    // bind events
    list.forEach(item => bindRow(item));
  }

  function rowHtml(x){
    const tagStr = (x.tags&&x.tags.length? ' · #'+x.tags.map(escapeHtml).join(' #'): '');
    return `<div class="row" data-id="${x.id}" style="border-bottom:1px solid rgba(255,255,255,0.06); padding:10px 0;">
      <div><b>${x.date}</b> · ${x.type==='income'?'+':'-'}${Number(x.amount).toFixed(2)} <span class="muted">${escapeHtml(x.note||'')}${tagStr}</span></div>
      <div class="row row-2">
        <div class="row">
          <select class="edit-type"><option value="expense" ${x.type==='expense'?'selected':''}>支出</option><option value="income" ${x.type==='income'?'selected':''}>收入</option></select>
          <input class="edit-amount" type="number" step="0.01" value="${x.amount}" />
        </div>
        <div class="row">
          <input class="edit-date" type="date" value="${x.date}" />
          <input class="edit-note" placeholder="备注" value="${escapeHtml(x.note||'')}" />
          <input class="edit-tags" placeholder="标签,逗号分隔" value="${escapeHtml((x.tags||[]).join(','))}" />
        </div>
      </div>
      <div class="row row-2">
        <button class="btn-save">保存修改</button>
        <button class="btn-del" style="background:#552a2a;border-color:#774040">删除</button>
      </div>
    </div>`;
  }

  function bindRow(x){
    const row = root.querySelector(`[data-id="${x.id}"]`);
    row.querySelector('.btn-save').addEventListener('click', async ()=>{
      const updated = {
        ...x,
        type: row.querySelector('.edit-type').value,
        amount: parseFloat(row.querySelector('.edit-amount').value),
        date: row.querySelector('.edit-date').value,
        note: row.querySelector('.edit-note').value,
        tags: String(row.querySelector('.edit-tags').value||'').split(',').map(s=>s.trim()).filter(Boolean)
      };
      if (isNaN(updated.amount) || updated.amount<=0) return alert('金额无效');
      await updateTransaction(updated);
      alert('已保存');
    });
    row.querySelector('.btn-del').addEventListener('click', async ()=>{
      if (!confirm('确定删除该条目？')) return;
      await removeTransaction(x.id);
      row.remove();
    });
  }
}

// --- Nav active state ---
function updateActiveNav(hash){ const nav = document.getElementById('nav'); if(!nav) return; const route = hash || '/'; nav.querySelectorAll('a').forEach(a => { a.classList.toggle('active', a.getAttribute('data-route')===route); }); }

// Handle iOS 100vh issue
function setVH(){ const vh = window.innerHeight * 0.01; document.documentElement.style.setProperty('--vh', `${vh}px`); }
setVH(); window.addEventListener('resize', setVH);
if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js').catch(()=>{}); }

mount();
