import { parse, serialize, titleOf, stats, slug, addTask } from './md.js';

const LIST_DIR = 'checklists';
const app = document.getElementById('app');
const DEMO = new URLSearchParams(location.search).has('demo'); // uses private browser storage instead of a real folder

const state = { root: null, dir: null, lists: [], editing: false };

// ---------- tiny helpers ----------
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('notes-app', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kvGet(k) {
  const db = await idb();
  return new Promise((res, rej) => {
    const r = db.transaction('kv').objectStore('kv').get(k);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kvSet(k, v) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(v, k);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}

function pref(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function setPref(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
}

// ---------- files ----------
async function loadLists() {
  const out = [];
  for await (const [name, handle] of state.dir.entries()) {
    if (handle.kind !== 'file' || !name.endsWith('.md')) continue;
    const file = await handle.getFile();
    out.push({ name, handle, lines: parse(await file.text()), modified: file.lastModified });
  }
  out.sort((a, b) => b.modified - a.modified);
  state.lists = out;
}

function save(list) {
  // Writes for one list run one after another, never overlapping.
  list.queue = (list.queue || Promise.resolve())
    .then(async () => {
      const w = await list.handle.createWritable();
      await w.write(serialize(list.lines));
      await w.close();
      list.modified = Date.now();
    })
    .catch((e) => toast(`Could not save: ${e.message}`));
  return list.queue;
}

async function exists(name) {
  try { await state.dir.getFileHandle(name); return true; } catch { return false; }
}

async function createList(title) {
  const base = slug(title);
  let name = `${base}.md`;
  for (let i = 2; await exists(name); i++) name = `${base}-${i}.md`;
  const handle = await state.dir.getFileHandle(name, { create: true });
  const list = { name, handle, lines: [{ kind: 'title', text: title }, { kind: 'other', raw: '' }], modified: Date.now() };
  state.lists.unshift(list);
  await save(list);
  return list;
}

// ---------- startup ----------
async function start() {
  if (DEMO) {
    state.root = await navigator.storage.getDirectory();
    return openRoot();
  }
  if (!('showDirectoryPicker' in window)) return renderUnsupported();
  state.root = await kvGet('root').catch(() => null);
  if (!state.root) return renderSetup();
  const perm = await state.root.queryPermission({ mode: 'readwrite' });
  if (perm === 'granted') return openRoot();
  renderReconnect();
}

async function openRoot() {
  state.dir = await state.root.getDirectoryHandle(LIST_DIR, { create: true });
  await loadLists();
  route();
}

async function pickFolder() {
  try {
    const dir = await showDirectoryPicker({ mode: 'readwrite', id: 'notes' });
    await kvSet('root', dir);
    state.root = dir;
    await openRoot();
  } catch (e) {
    if (e.name !== 'AbortError') toast(e.message);
  }
}

function screen(...children) {
  app.replaceChildren(h('div', { class: 'screen' }, ...children));
}

function renderUnsupported() {
  screen(
    h('h1', {}, 'Checklists'),
    h('p', {}, 'This browser can’t open folders. Use Chrome on Android or on the Mac.')
  );
}

function renderSetup() {
  screen(
    h('h1', {}, 'Checklists'),
    h('p', {}, 'Choose your notes folder (e.g. app-notes, the one Syncthing shares). Checklists are saved there as Markdown files in a “checklists” subfolder.'),
    h('button', { class: 'primary', onclick: pickFolder }, 'Choose folder')
  );
}

function renderReconnect() {
  screen(
    h('h1', {}, 'Checklists'),
    h('p', {}, `The browser needs your OK to open “${state.root.name}” again.`),
    h('button', {
      class: 'primary',
      onclick: async () => {
        const perm = await state.root.requestPermission({ mode: 'readwrite' });
        if (perm === 'granted') openRoot();
        else toast('No access — try again or choose another folder.');
      },
    }, `Reconnect “${state.root.name}”`),
    h('button', { class: 'link', onclick: pickFolder }, 'Choose a different folder')
  );
}

// ---------- routing ----------
function route() {
  const m = location.hash.match(/^#\/l\/(.+)$/);
  if (m) renderList(decodeURIComponent(m[1]));
  else renderHome();
}
window.addEventListener('hashchange', () => state.dir && route());

// Pick up changes that arrived via Syncthing while the app was in the background.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !state.dir || state.editing) return;
  try { await loadLists(); route(); } catch (e) { toast(e.message); }
});

// ---------- home: all checklists ----------
function renderHome() {
  const input = h('input', { placeholder: 'New checklist…', enterkeyhint: 'go', autocomplete: 'off', 'aria-label': 'New checklist name' });
  const form = h('form', {
    class: 'add',
    onsubmit: async (e) => {
      e.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      const list = await createList(title);
      location.hash = `#/l/${encodeURIComponent(list.name)}`;
    },
  }, input, h('button', { class: 'add-btn', 'aria-label': 'Create' }, '+'));

  const rows = state.lists.map((list) => {
    const { total, done } = stats(list.lines);
    const conflict = list.name.includes('.sync-conflict-');
    return h('li', {},
      h('a', { href: `#/l/${encodeURIComponent(list.name)}`, class: 'row' },
        h('span', { class: 'row-title' }, conflict ? '⚠️ ' : '', titleOf(list), conflict ? h('small', {}, ' (conflict copy)') : null),
        h('span', { class: 'row-meta' }, total ? `${done}/${total}` : '–'),
        h('span', { class: 'bar' }, h('span', { style: `width:${total ? (100 * done) / total : 0}%` }))
      )
    );
  });

  screen(
    h('header', {}, h('h1', {}, 'Checklists')),
    form,
    rows.length ? h('ul', { class: 'lists' }, rows) : h('p', { class: 'muted' }, 'No checklists yet. Type a name above.'),
    h('footer', { class: 'muted' },
      DEMO ? 'Demo mode — stored in this browser only.' : `Folder: ${state.root.name}/${LIST_DIR} · `,
      DEMO ? null : h('button', { class: 'link', onclick: pickFolder }, 'change')
    )
  );
}

// ---------- one checklist ----------
function renderList(name) {
  const list = state.lists.find((l) => l.name === name);
  if (!list) { toast('Checklist not found'); location.hash = '#/'; return; }
  const rerender = () => renderList(name);
  const tasks = list.lines.filter((l) => l.kind === 'task');
  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  const { total } = stats(list.lines);
  const showDone = pref('showDone', true);

  const input = h('input', { placeholder: 'Add item…', enterkeyhint: 'enter', autocomplete: 'off', 'aria-label': 'New item' });
  const addForm = h('form', {
    class: 'add',
    onsubmit: (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      addTask(list.lines, text);
      save(list);
      rerender();
      document.querySelector('.add input')?.focus(); // keep the keyboard up for quick entry
    },
  }, input, h('button', { class: 'add-btn', 'aria-label': 'Add' }, '+'));

  const menuAction = (fn) => async (e) => {
    e.target.closest('details').open = false;
    await fn();
  };
  const menu = h('details', { class: 'menu' },
    h('summary', { 'aria-label': 'More' }, '⋯'),
    h('div', { class: 'menu-items' },
      h('button', { onclick: menuAction(() => { tasks.forEach((t) => (t.done = false)); save(list); rerender(); }) }, 'Uncheck all'),
      h('button', { onclick: menuAction(() => {
        if (!done.length || !confirm(`Delete ${done.length} checked item(s)?`)) return;
        list.lines = list.lines.filter((l) => !(l.kind === 'task' && l.done));
        save(list); rerender();
      }) }, 'Delete checked items'),
      h('button', { onclick: menuAction(() => {
        const t = prompt('Rename checklist', titleOf(list));
        if (!t || !t.trim()) return;
        const titleLine = list.lines.find((l) => l.kind === 'title');
        if (titleLine) titleLine.text = t.trim();
        else list.lines.unshift({ kind: 'title', text: t.trim() }, { kind: 'other', raw: '' });
        save(list); rerender();
      }) }, 'Rename'),
      h('button', { class: 'danger', onclick: menuAction(async () => {
        if (!confirm(`Delete “${titleOf(list)}”? The file will be removed on all synced devices.`)) return;
        await list.queue;
        await state.dir.removeEntry(list.name);
        state.lists = state.lists.filter((l) => l !== list);
        location.hash = '#/';
      }) }, 'Delete checklist')
    )
  );

  screen(
    h('header', {},
      h('a', { href: '#/', class: 'back', 'aria-label': 'Back' }, '‹'),
      h('h1', {}, titleOf(list)),
      menu
    ),
    total ? h('div', { class: 'progress' }, h('span', { class: 'bar' }, h('span', { style: `width:${(100 * done.length) / total}%` })), h('small', {}, `${done.length}/${total}`)) : null,
    h('ul', { class: 'items' }, open.map((t) => itemRow(list, t, rerender))),
    addForm,
    done.length
      ? h('section', { class: 'done-section' },
          h('button', { class: 'done-toggle', onclick: () => { setPref('showDone', !showDone); rerender(); } },
            `${showDone ? '▾' : '▸'} Done (${done.length})`),
          showDone ? h('ul', { class: 'items done' }, done.map((t) => itemRow(list, t, rerender))) : null
        )
      : null
  );
  if (!total) input.focus();
}

function itemRow(list, line, rerender) {
  const cb = h('input', {
    type: 'checkbox',
    checked: line.done,
    'aria-label': line.text,
    onchange: () => {
      line.done = cb.checked;
      save(list);
      setTimeout(rerender, 250); // let the tick show before the item moves
    },
  });
  const text = h('span', { class: 'text' }, line.text);
  const li = h('li', { style: line.indent ? `padding-left:${line.indent.length * 0.6}rem` : null },
    h('label', { class: 'check' }, cb), text);

  text.addEventListener('click', () => {
    state.editing = true;
    let finished = false;
    const finish = (action) => {
      if (finished) return;
      finished = true;
      state.editing = false;
      const v = edit.value.trim();
      if (action === 'delete' || !v) list.lines = list.lines.filter((l) => l !== line);
      else line.text = v;
      save(list);
      rerender();
    };
    const edit = h('input', {
      class: 'edit',
      value: line.text,
      enterkeyhint: 'done',
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); finish('save'); } },
      onblur: () => finish('save'),
    });
    const del = h('button', {
      class: 'del',
      'aria-label': 'Delete item',
      onpointerdown: (e) => { e.preventDefault(); finish('delete'); },
    }, '×');
    text.replaceWith(edit, del);
    edit.focus();
    edit.setSelectionRange(edit.value.length, edit.value.length);
  });
  return li;
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
start().catch((e) => toast(e.message));
