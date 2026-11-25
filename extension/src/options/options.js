'use strict';

const { DEFAULTS, clean, load, save } = self.Frost;
const $ = (id) => document.getElementById(id);

let settings = clean();

function choose(select, value, unit) {
  if (![...select.options].some((o) => Number(o.value) === value)) {
    select.add(new Option(`${value} ${unit}`, String(value)));
  }
  select.value = String(value);
}

function render() {
  $('chatWindow').checked = settings.chatWindow;
  choose($('chatRehide'), settings.chatRehide, 'seconds');
  $('chatLeave').checked = settings.chatRehideOnLeave;
  $('chat-rows').toggleAttribute('data-inactive', !settings.chatWindow);

  $('grayscale').checked = settings.grayscale;
  $('hover').checked = settings.hoverReveal;
  const delay = $('revealDelay');
  if (document.activeElement !== delay) delay.value = settings.revealDelay;
  delay.disabled = !settings.hoverReveal;
  delay.style.setProperty('--fill', `${(settings.revealDelay / Number(delay.max)) * 100}%`);
  $('revealDelay-out').textContent = `${settings.revealDelay} ms`;
  delay.closest('.rows').toggleAttribute('data-inactive', !settings.hoverReveal);

  $('away').checked = settings.hideWhenAway;
  choose($('idle'), settings.hideAfterIdle, 'seconds');
}

async function refresh() {
  settings = await load();
  render();
}

async function change(changes) {
  settings = clean(Object.assign({}, settings, changes));
  render();
  await save(changes);
}

$('chatWindow').addEventListener('change', (e) => change({ chatWindow: e.target.checked }));
$('chatRehide').addEventListener('change', (e) => change({ chatRehide: Number(e.target.value) }));
$('chatLeave').addEventListener('change', (e) => change({ chatRehideOnLeave: e.target.checked }));
$('grayscale').addEventListener('change', (e) => change({ grayscale: e.target.checked }));
$('hover').addEventListener('change', (e) => change({ hoverReveal: e.target.checked }));
$('revealDelay').addEventListener('input', (e) => change({ revealDelay: Number(e.target.value) }));
$('away').addEventListener('change', (e) => change({ hideWhenAway: e.target.checked }));
$('idle').addEventListener('change', (e) => change({ hideAfterIdle: Number(e.target.value) }));

$('reset').addEventListener('click', async () => {
  await chrome.storage.local.set({ settings: Object.assign({}, DEFAULTS), hidden: false });
  $('reset-feedback').textContent = 'Defaults restored.';
});

chrome.commands.getAll().then((commands) => {
  for (const command of commands) {
    const target = $(`k-${command.name}`);
    if (!target) continue;
    if (!command.shortcut) {
      target.textContent = 'Not set';
      continue;
    }
    target.replaceChildren(
      ...command.shortcut.split('+').map((part) => {
        const k = document.createElement('kbd');
        k.textContent = part;
        return k;
      }),
    );
  }
});
$('keys-change').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

$('version').textContent = chrome.runtime.getManifest().version;
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') refresh();
});
refresh();
