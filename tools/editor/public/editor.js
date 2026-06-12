/* The work.yaml editor client. Plain JS, no build step.
 *
 * State is the single source of truth; the DOM is rebuilt from it after every
 * STRUCTURAL change (reorder, add, delete, load, save). Text inputs write
 * straight into state with no re-render, so focus and caret never jump.
 * Sortable is global (loaded from /vendor/sortable.js). */
/* global Sortable */

const state = { projects: [], rev: null, dirty: false };
let sortables = [];

const $ = (sel, el = document) => el.querySelector(sel);
const projectsEl = $('#projects');
const saveBtn = $('#save');
const statusEl = $('#status');
const errorEl = $('#error');

// Mirrors work.ts youtubeId/youtubePoster (the editor page cannot import TS modules).
const youtubeId = (src) => {
  const m = src.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=|v\/|shorts\/))([\w-]{11})/);
  return m ? m[1] : src.trim();
};
// Posters overwritten in place (a re-picked frame keeps the same filename) need
// a cache-buster so the strip <img> shows the new pixels immediately.
const posterBust = new Map();
const thumbSrc = (a) => {
  const base = a.poster ?? (a.type === 'youtube' ? `https://i.ytimg.com/vi/${youtubeId(a.src)}/mqdefault.jpg` : a.src);
  const bust = a.poster && posterBust.get(a.poster);
  return bust ? `${base}?t=${bust}` : base;
};

const defaultOrientation = (p) => {
  const counts = { portrait: 0, landscape: 0 };
  for (const a of p.assets) counts[a.orientation]++;
  if (counts.portrait !== counts.landscape) return counts.portrait > counts.landscape ? 'portrait' : 'landscape';
  if (p.assets.length > 0) return p.assets[0].orientation;
  return p.device === 'iphone' ? 'portrait' : 'landscape';
};

// A dropped file's default alt text: the filename lowercased, with its extension dropped.
const defaultAlt = (filename) => filename.replace(/\.[^.]+$/, '').toLowerCase();

function setStatus(text) { statusEl.textContent = text; }
function showError(message) { errorEl.hidden = !message; errorEl.textContent = message || ''; }
function markDirty() {
  state.dirty = true;
  saveBtn.disabled = false;
  saveBtn.classList.add('dirty');
  setStatus('unsaved changes');
}
function markClean(verb) {
  state.dirty = false;
  saveBtn.disabled = true;
  saveBtn.classList.remove('dirty');
  setStatus(`${verb} at ${new Date().toLocaleTimeString()}`);
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

function textField(obj, key, label, wide) {
  const input = el('input', { type: 'text', value: obj[key] ?? '' });
  input.addEventListener('input', () => { obj[key] = input.value; markDirty(); });
  return el('div', { class: `field${wide ? ' wide' : ''}` }, el('label', {}, label), input);
}

function renderLinks(p) {
  const list = el('div', { class: 'links' });
  for (const [i, link] of p.links.entries()) {
    const label = el('input', { class: 'label', type: 'text', value: link.label, placeholder: 'label' });
    label.addEventListener('input', () => { link.label = label.value; markDirty(); });
    const href = el('input', { type: 'text', value: link.href, placeholder: 'https://... or /page' });
    href.addEventListener('input', () => { link.href = href.value; markDirty(); });
    list.append(el('div', { class: 'link-row' },
      el('span', { class: 'handle' }, '⠿'), label, href,
      el('button', { class: 'icon-btn', type: 'button', title: 'remove link',
        onclick: () => { p.links.splice(i, 1); markDirty(); render(); } }, '✕'),
    ));
  }
  return list;
}

function renderAssets(p) {
  const strip = el('div', { class: 'strip' });
  if (p.assets.length === 0) strip.append(el('p', { class: 'empty' }, 'no images yet. drop files here'));
  for (const [i, a] of p.assets.entries()) {
    const alt = el('input', { class: `alt${a.alt ? '' : ' missing'}`, type: 'text', value: a.alt, placeholder: 'alt text (required)' });
    alt.addEventListener('input', () => { a.alt = alt.value; alt.classList.toggle('missing', !alt.value); markDirty(); });
    const pic = el('div', { class: 'pic' },
      el('img', { src: thumbSrc(a), alt: '', draggable: 'false' }),
      el('button', { class: 'del', type: 'button', title: 'remove from gallery (file stays in public/)',
        onclick: () => { p.assets.splice(i, 1); markDirty(); render(); } }, '✕'),
    );
    if (a.type !== 'image') pic.append(el('span', { class: 'badge' }, a.type));
    if (a.type === 'video') {
      pic.append(el('button', { class: 'frame-btn', type: 'button', title: 'choose the thumbnail frame',
        onclick: () => openFramePicker(a) }, '⌖ frame'));
    }
    strip.append(el('div', { class: 'thumb', 'data-orientation': a.orientation }, pic, alt));
  }
  // Accept file drops (images/PDFs/videos) and dragged YouTube URLs.
  const droppable = (e) => {
    const t = [...e.dataTransfer.types];
    return t.includes('Files') || t.includes('text/uri-list');
  };
  strip.addEventListener('dragover', (e) => {
    if (!droppable(e)) return;
    e.preventDefault();
    strip.classList.add('dragover');
  });
  strip.addEventListener('dragleave', () => strip.classList.remove('dragover'));
  strip.addEventListener('drop', (e) => {
    if (!droppable(e)) return;
    e.preventDefault();
    strip.classList.remove('dragover');
    if ([...e.dataTransfer.types].includes('Files')) {
      uploadFiles(p, [...e.dataTransfer.files]);
      return;
    }
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (/youtu/i.test(text)) addYoutube(p, text);
  });
  return strip;
}

function render() {
  for (const s of sortables) s.destroy();
  sortables = [];
  projectsEl.replaceChildren();

  for (const p of state.projects) {
    const links = renderLinks(p);
    const strip = renderAssets(p);
    const card = el('section', { class: 'project', 'data-slug': p.slug },
      el('div', { class: 'project-head' },
        el('span', { class: 'handle project-handle' }, '⠿'),
        el('span', { class: 'slug', title: 'slug, from work.yaml: the stable id and the /work/<slug>/ URL. Edit in the YAML.' }, p.slug),
        el('span', { class: 'device', title: 'device, from work.yaml: rounds thumbnails and lightbox media like this screen. Edit in the YAML.' }, p.device),
      ),
      el('div', { class: 'fields' },
        textField(p, 'cardTitle', 'card title'),
        textField(p, 'title', 'page title'),
        textField(p, 'subtitle', 'subtitle'),
        textField(p, 'date', 'date (optional, e.g. 2018-present)'),
        textField(p, 'role', 'role', true),
        textField(p, 'cardDesc', 'meta description (case-study SEO; not shown on the page)', true),
      ),
      el('h3', { class: 'sect' }, 'links'),
      links,
      el('button', { class: 'add-btn', type: 'button',
        onclick: () => { p.links.push({ label: '', href: '' }); markDirty(); render(); } }, '+ add link'),
      el('h3', { class: 'sect' }, 'gallery'),
      strip,
      el('div', { class: 'adders' },
        urlAdder(p, '+ add YouTube', 'YouTube URL or video id', (v) => addYoutube(p, v)),
        embedAdder(p),
      ),
    );
    projectsEl.append(card);

    sortables.push(new Sortable(links, {
      forceFallback: true,
      animation: 150,
      handle: '.handle',
      onEnd: ({ oldIndex, newIndex }) => {
        p.links.splice(newIndex, 0, p.links.splice(oldIndex, 1)[0]);
        markDirty();
        render();
      },
    }));
    sortables.push(new Sortable(strip, {
      forceFallback: true,
      animation: 150,
      draggable: '.thumb',
      filter: 'input,button',
      preventOnFilter: false,
      onEnd: ({ oldIndex, newIndex }) => {
        p.assets.splice(newIndex, 0, p.assets.splice(oldIndex, 1)[0]);
        markDirty();
        render();
      },
    }));
  }

  sortables.push(new Sortable(projectsEl, {
    forceFallback: true,
    animation: 150,
    handle: '.project-handle',
    onEnd: ({ oldIndex, newIndex }) => {
      state.projects.splice(newIndex, 0, state.projects.splice(oldIndex, 1)[0]);
      markDirty();
      render();
    },
  }));
}

// Video extensions whose drop triggers a (slow) server-side transcode to MP4, so
// the status can warn instead of looking frozen.
const TRANSCODE_RE = /\.(mov|m4v|avi|mkv|wmv|flv|mpe?g|mpe|ogv|3gp|3g2|m?ts|m2ts|vob|mxf|asf|f4v|divx)$/i;

async function uploadFiles(p, files) {
  for (const file of files) {
    setStatus(TRANSCODE_RE.test(file.name)
      ? `converting ${file.name}… (transcoding to web-ready MP4, this can take a while)`
      : `adding ${file.name}…`);
    const res = await fetch(`/api/upload?slug=${encodeURIComponent(p.slug)}&name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      body: file,
    });
    const data = await res.json();
    if (!res.ok) { showError(data.error); continue; }
    // The server renders posters for pdf/video drops and says so via assetType.
    const asset = {
      type: data.assetType ?? (/\.gif$/i.test(file.name) ? 'gif' : 'image'),
      src: data.src,
      alt: defaultAlt(file.name),
      orientation: defaultOrientation(p),
    };
    if (data.poster) asset.poster = data.poster;
    p.assets.push(asset);
    markDirty();
  }
  if (!state.dirty) setStatus('');
  render();
}

/**
 * The video frame picker: scrub the real video in a modal, capture the paused
 * frame as the asset's poster. The server extracts the exact frame with ffmpeg
 * (POST /api/poster), so the client only ever sends a timestamp. Works on any
 * existing video asset; the video file itself is never touched.
 */
function openFramePicker(a) {
  const video = el('video', { src: a.src, controls: '', preload: 'metadata' });
  const time = el('span', { class: 'time' }, '0.000s');
  const showTime = () => { time.textContent = `${video.currentTime.toFixed(3)}s`; };
  video.addEventListener('timeupdate', showTime);
  video.addEventListener('seeked', showTime);
  const nudge = (frames) => {
    video.pause();
    // duration is NaN until metadata arrives; the element clamps real seeks itself.
    const max = Number.isFinite(video.duration) ? video.duration : Infinity;
    video.currentTime = Math.max(0, Math.min(max, video.currentTime + frames / 30));
  };
  const close = () => { document.removeEventListener('keydown', onKey); overlay.remove(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === ',') { e.preventDefault(); nudge(-1); }
    else if (e.key === '.') { e.preventDefault(); nudge(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // Skip when the native controls have focus: the element seeks ±5s itself.
      if (e.target !== video) { e.preventDefault(); nudge(e.key === 'ArrowLeft' ? -30 : 30); }
    }
  };
  const useBtn = el('button', { class: 'add-btn use-frame', type: 'button' }, 'use this frame');
  useBtn.addEventListener('click', async () => {
    video.pause();
    // Back off a hair from the very end: the final timestamp often has no decodable frame.
    const t = Math.max(0, Math.min(video.currentTime, (video.duration || video.currentTime) - 0.05));
    useBtn.disabled = true;
    setStatus('extracting frame…');
    try {
      const res = await fetch(`/api/poster?src=${encodeURIComponent(a.src)}&t=${t}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { showError(data.error); setStatus(state.dirty ? 'unsaved changes' : ''); return; }
      a.poster = data.poster;
      posterBust.set(a.poster, Date.now());
      showError('');
      markDirty();
      close();
      render();
    } finally {
      useBtn.disabled = false;
    }
  });
  const overlay = el('div', { class: 'picker-overlay' },
    el('div', { class: 'picker' },
      video,
      el('div', { class: 'picker-bar' },
        el('button', { class: 'icon-btn', type: 'button', title: 'back one frame (,) · one second (left arrow)', onclick: () => nudge(-1) }, '‹'),
        time,
        el('button', { class: 'icon-btn', type: 'button', title: 'forward one frame (.) · one second (right arrow)', onclick: () => nudge(1) }, '›'),
        useBtn,
        el('button', { class: 'icon-btn', type: 'button', title: 'cancel (Esc)', onclick: () => close() }, '✕'),
      ),
    ),
  );
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
}

/** An inline "add by URL" row: a toggle button revealing an input + add. */
function urlAdder(p, buttonLabel, placeholder, onAdd) {
  const input = el('input', { type: 'text', placeholder });
  const addBtn = el('button', { class: 'add-btn', type: 'button' }, 'add');
  const row = el('div', { class: 'url-row' }, input, addBtn);
  row.hidden = true;
  const toggle = el('button', { class: 'add-btn', type: 'button' }, buttonLabel);
  toggle.addEventListener('click', () => { row.hidden = !row.hidden; if (!row.hidden) input.focus(); });
  const submit = async () => {
    addBtn.disabled = true;
    try { await onAdd(input.value.trim()); } finally { addBtn.disabled = false; }
  };
  addBtn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  return el('div', { class: 'adder' }, toggle, row);
}

async function addYoutube(p, value) {
  const id = youtubeId(value);
  if (!/^[\w-]{11}$/.test(id)) { showError(`"${value}" does not look like a YouTube URL or 11-char video id`); return; }
  p.assets.push({ type: 'youtube', src: `https://www.youtube.com/embed/${id}`, alt: '', orientation: 'landscape' });
  showError('');
  markDirty();
  render();
}

async function addEmbed(p, value, w, h) {
  if (!/^https?:\/\//.test(value)) { showError(`a web view needs a full http(s) URL, got "${value}"`); return; }
  if (!(w >= 200 && w <= 3000) || !(h >= 200 && h <= 3000)) { showError(`thumbnail size must be 200..3000 px per side, got ${w}x${h}`); return; }
  setStatus('rendering web view poster...');
  const res = await fetch(`/api/webshot?slug=${encodeURIComponent(p.slug)}&url=${encodeURIComponent(value)}&w=${w}&h=${h}`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) { showError(data.error); setStatus(state.dirty ? 'unsaved changes' : ''); return; }
  // The poster's aspect is what sizes the strip thumb, so orientation follows it.
  p.assets.push({ type: 'embed', src: value, poster: data.poster, alt: '', orientation: h >= w ? 'portrait' : 'landscape' });
  showError('');
  markDirty();
  render();
}

/**
 * "+ add web view": URL plus a REQUIRED thumbnail size. The size is the
 * viewport the poster is screenshotted at; it controls only the strip
 * thumbnail (its aspect and framing). The lightbox always shows the live
 * iframe. Prefilled phone-ish for portrait galleries, desktop for landscape.
 */
function embedAdder(p) {
  const portrait = defaultOrientation(p) === 'portrait';
  const urlInput = el('input', { type: 'text', placeholder: 'https://... (shown as an iframe)' });
  const wInput = el('input', { class: 'dim', type: 'number', value: portrait ? '390' : '1440', title: 'thumbnail width: the capture viewport in px' });
  const hInput = el('input', { class: 'dim', type: 'number', value: portrait ? '844' : '900', title: 'thumbnail height: the capture viewport in px' });
  const addBtn = el('button', { class: 'add-btn', type: 'button' }, 'add');
  const row = el('div', { class: 'url-row' }, urlInput, wInput, el('span', { class: 'by' }, 'x'), hInput, addBtn);
  row.hidden = true;
  const toggle = el('button', { class: 'add-btn', type: 'button' }, '+ add web view');
  toggle.addEventListener('click', () => { row.hidden = !row.hidden; if (!row.hidden) urlInput.focus(); });
  const submit = async () => {
    addBtn.disabled = true;
    try { await addEmbed(p, urlInput.value.trim(), Number(wInput.value), Number(hInput.value)); } finally { addBtn.disabled = false; }
  };
  addBtn.addEventListener('click', submit);
  for (const i of [urlInput, wInput, hInput]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  return el('div', { class: 'adder' }, toggle, row);
}

async function load() {
  const res = await fetch('/api/work');
  const data = await res.json();
  if (!res.ok) { showError(data.error); return; }
  state.projects = data.projects;
  state.rev = data.rev;
  showError('');
  markClean('loaded');
  render();
}

async function save() {
  if (!state.dirty) return;
  const res = await fetch('/api/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rev: state.rev, projects: state.projects }),
  });
  const data = await res.json();
  if (!res.ok) {
    showError(data.error + (res.status === 409 ? '\n(reload the page to pick up the on-disk version)' : ''));
    return;
  }
  // Fresh server state: _ids are re-stamped against the file just written.
  state.projects = data.projects;
  state.rev = data.rev;
  showError('');
  markClean('saved');
  render();
}

saveBtn.addEventListener('click', save);
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
});
window.addEventListener('beforeunload', (e) => {
  if (state.dirty) e.preventDefault();
});

load();
