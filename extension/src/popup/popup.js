'use strict';

const { TARGETS, PRESETS, clean, load, save } = self.Frost;
const $ = (id) => document.getElementById(id);

let settings = clean();
let hidden = false;

// The three strengths share one slider; the dial above it picks which one it moves.
const SLIDERS = ['textBlur', 'mediaBlur', 'chatBlur'];
let dial = 'textBlur';

// ── Render ──

function renderDial() {
  for (const button of document.querySelectorAll('.dial')) {
    const on = button.dataset.dial === dial;
    button.setAttribute('aria-selected', String(on));
    button.tabIndex = on ? 0 : -1;
  }
  for (const key of SLIDERS) $(key).hidden = key !== dial;
  $('slider-min').textContent = $(dial).min;
  $('slider-max').textContent = $(dial).max;
}

function fill(input) {
  const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--fill', `${pct}%`);
}

function renderPreview(s) {
  const preview = $('preview');
  preview.toggleAttribute('data-on', s.enabled);
  preview.toggleAttribute('data-hover', s.hoverReveal);
  preview.style.setProperty('--text', `${s.textBlur}px`);
  preview.style.setProperty('--media', `${s.mediaBlur}px`);
  preview.style.setProperty('--gray', s.grayscale ? '1' : '0');
  preview.style.setProperty('--delay', `${s.revealDelay}ms`);
  for (const part of preview.querySelectorAll('[data-part]')) {
    part.toggleAttribute('data-blur', s[part.dataset.part]);
  }
}

function render() {
  const s = settings;
  $('enabled').checked = s.enabled;
  document.body.toggleAttribute('data-off', !s.enabled);
  for (const input of document.querySelectorAll('[data-key]')) input.checked = s[input.dataset.key];
  $('hover').checked = s.hoverReveal;

  for (const key of SLIDERS) {
    const input = $(key);
    if (document.activeElement !== input) input.value = s[key];
    const unit = document.createElement('span');
    unit.className = 'unit';
    unit.textContent = ' px';
    $(`${key}-out`).replaceChildren(String(s[key]), unit);
    fill(input);
  }
  renderDial();

  for (const b of $('presets').querySelectorAll('button')) {
    const p = PRESETS[b.dataset.preset];
    b.setAttribute('aria-pressed', String(Object.keys(p).every((k) => p[k] === s[k])));
  }

  $('hide').textContent = hidden ? 'Show window' : 'Hide window';
  renderPreview(s);
}

async function refresh() {
  settings = await load();
  ({ hidden } = await chrome.storage.local.get('hidden'));
  hidden = hidden === true;
  render();
}

// ── Saving ──
// Sliders save at most every 60 ms while dragging so WhatsApp follows the thumb live.

let pending = {};
let timer = 0;
function queue(changes) {
  Object.assign(pending, changes);
  settings = clean(Object.assign({}, settings, changes));
  render();
  if (timer) return;
  timer = setTimeout(async () => {
    const batch = pending;
    pending = {};
    timer = 0;
    await save(batch);
  }, 60);
}

$('enabled').addEventListener('change', (e) => queue({ enabled: e.target.checked }));
for (const input of document.querySelectorAll('[data-key]')) {
  input.addEventListener('change', () => queue({ [input.dataset.key]: input.checked }));
}
$('hover').addEventListener('change', (e) => queue({ hoverReveal: e.target.checked }));
for (const key of SLIDERS) {
  $(key).addEventListener('input', (e) => queue({ [key]: Number(e.target.value) }));
}
document.querySelector('.dials').addEventListener('click', (e) => {
  const button = e.target.closest('.dial');
  if (!button) return;
  dial = button.dataset.dial;
  renderDial();
});
// Arrow keys move between dials, as in any tab list.
document.querySelector('.dials').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const step = e.key === 'ArrowRight' ? 1 : -1;
  dial = SLIDERS[(SLIDERS.indexOf(dial) + step + SLIDERS.length) % SLIDERS.length];
  renderDial();
  document.querySelector(`.dial[data-dial="${dial}"]`).focus();
  e.preventDefault();
});
$('presets').addEventListener('click', (e) => {
  const button = e.target.closest('button[data-preset]');
  if (button) queue(PRESETS[button.dataset.preset]);
});

$('hide').addEventListener('click', () => chrome.storage.local.set({ hidden: !hidden }));
$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage().then(() => window.close()));

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local' && !timer) refresh();
});

// ── Shortcuts, as configured in chrome://extensions/shortcuts ──

function keys(shortcut, label) {
  const out = document.createDocumentFragment();
  if (!shortcut) return out;
  for (const part of shortcut.split('+')) {
    const k = document.createElement('kbd');
    k.textContent = part;
    out.append(k);
  }
  if (label) out.append(` ${label}`);
  return out;
}

chrome.commands.getAll().then((commands) => {
  const by = Object.fromEntries(commands.map((c) => [c.name, c.shortcut]));
  $('hide-keys').replaceChildren(keys(by['hide-window']));
  if (by['toggle-blur']) $('enabled-label').title = `Blur on or off (${by['toggle-blur']})`;
});

// ── Status ──
// No "tabs" permission: every tab is asked, and only Frost's own script on WhatsApp answers.
// The question doubles as a ping that keeps WhatsApp from hiding itself while this popup is open.

function ask(tabId) {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, { type: 'status' }),
    new Promise((resolve) => setTimeout(() => resolve(null), 500)),
  ]).catch(() => null);
}

async function status() {
  const tabs = await chrome.tabs.query({});
  const answers = (await Promise.all(tabs.map((t) => ask(t.id)))).filter(Boolean);
  const el = $('status');
  el.removeAttribute('data-tone');

  if (answers.length === 0) {
    el.textContent = 'WhatsApp Web isn’t open';
    return;
  }
  const best = answers.find((a) => a.signedIn) || answers[0];
  if (best.hidden) {
    el.textContent = 'Window hidden';
  } else if (!best.signedIn) {
    el.textContent = 'WhatsApp Web is open, not signed in';
  } else if (!settings.enabled) {
    el.textContent = 'Off, nothing is blurred';
  } else if (best.rows === 0) {
    el.textContent = 'No chats recognised. WhatsApp may have changed its layout.';
    el.dataset.tone = 'warn';
  } else {
    el.textContent = `On · ${best.rows} chats in view`;
  }
}

refresh();
status();
setInterval(status, 1000);
