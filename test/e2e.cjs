// End-to-end test: loads the unpacked extension into Chromium, serves a WhatsApp-shaped page at
// https://web.whatsapp.com (with a strict CSP), and drives the popup and settings page.
//
//   node test/e2e.cjs [screenshot-dir]
//
// Needs Playwright. Set PLAYWRIGHT to its package path if it is not resolvable from here.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

const EXT = path.resolve(__dirname, '../extension');
const FIX = path.join(__dirname, 'fixtures');
const SHOTS = process.argv[2] ? path.resolve(process.argv[2]) : null;

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob: https://pps.whatsapp.net",
  "font-src 'self' data:",
  "connect-src 'self'",
].join('; ');

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(['ok', name]);
    console.log(`  ok    ${name}`);
  } catch (err) {
    if (err && err.skip) {
      results.push(['skip', name]);
      console.log(`  skip  ${name}\n        ${err.message}`);
      return;
    }
    results.push(['FAIL', name, err]);
    console.log(`  FAIL  ${name}\n        ${String(err && err.message).split('\n')[0]}`);
  }
}
function skip(message) {
  throw Object.assign(new Error(message), { skip: true });
}
function assert(cond, message) {
  if (!cond) throw new Error(message);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, message, timeout = 4000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(40);
  }
  throw new Error(`${message} (timed out)${until.describe ? ` — ${await until.describe()}` : ''}`);
}

// ── Static checks: what the code is allowed to do at all ──

function staticChecks() {
  console.log('\nSource');
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  const js = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (p.endsWith('.js')) js.push([path.relative(EXT, p), fs.readFileSync(p, 'utf8')]);
    }
  })(path.join(EXT, 'src'));

  return Promise.all([
    check('permissions are only "storage"; no host permissions, no exposed files', () => {
      assert(JSON.stringify(manifest.permissions) === '["storage"]', JSON.stringify(manifest.permissions));
      assert(!manifest.host_permissions && !manifest.optional_permissions && !manifest.optional_host_permissions, 'extra permissions');
      assert(!manifest.web_accessible_resources, 'web_accessible_resources present');
      assert(!manifest.externally_connectable, 'externally_connectable present');
      assert(manifest.content_scripts.every((c) => !c.world || c.world === 'ISOLATED'), 'script in page world');
      assert(/connect-src 'none'/.test(manifest.content_security_policy.extension_pages), 'CSP allows connections');
    }),
    check('no code can send data or run strings', () => {
      const banned = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts\((?!'shared\/settings\.js')|eval|Function\(|postMessage|navigator\.sendBeacon|chrome\.runtime\.connectNative|chrome\.identity)\b/;
      const hits = js.filter(([, src]) => banned.test(src)).map(([f, src]) => `${f}: ${src.match(banned)[0]}`);
      assert(hits.length === 0, hits.join(', '));
    }),
    check('the content script never reads page content', () => {
      const [, src] = js.find(([f]) => f.endsWith('content/frost.js'));
      const reading = /\.(textContent|innerText|innerHTML|outerHTML|value|src|title|href|currentSrc)\b|getAttribute\((?!'data-frost)|\.dataset\b|getComputedStyle|Selection|clipboard|toDataURL|drawImage/;
      assert(!reading.test(src), `found ${src.match(reading)}`);
    }),
  ]);
}

(async () => {
  await staticChecks();

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'frost-e2e-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: !process.env.HEADED,
    viewport: { width: 1280, height: 760 },
    deviceScaleFactor: SHOTS ? 2 : 1, // crisp README screenshots
    colorScheme: 'light',
    // Frost drops its fade under reduced motion, so computed styles settle at once.
    reducedMotion: 'reduce',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });

  const requests = [];
  context.on('request', (r) => requests.push(r.url()));
  const pageErrors = [];
  const watch = (page) => {
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && pageErrors.push(m.text()));
  };

  await context.route('https://web.whatsapp.com/**', (route) => {
    const { pathname } = new URL(route.request().url());
    const files = { '/': 'whatsapp.html', '/mock.js': 'mock.js', '/mock.css': 'mock.css' };
    const file = files[pathname];
    if (!file) return route.fulfill({ status: 404, body: '' });
    const type = { html: 'text/html', js: 'text/javascript', css: 'text/css' }[file.split('.').pop()];
    route.fulfill({
      status: 200,
      contentType: type,
      headers: { 'content-security-policy': CSP },
      body: fs.readFileSync(path.join(FIX, file)),
    });
  });
  await context.route('https://pps.whatsapp.net/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(path.join(EXT, 'icons/128.png')) }),
  );

  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extId = new URL(worker.url()).host;
  const extUrl = (p) => `chrome-extension://${extId}/${p}`;
  const setSettings = (changes) =>
    worker.evaluate((c) => self.Frost.save(c), changes);

  const wa = await context.newPage();
  watch(wa);
  await wa.goto('https://web.whatsapp.com/');
  await wa.waitForSelector('#pane-side [role="listitem"]');

  const filterOf = (selector, page = wa) =>
    page.evaluate((s) => {
      const el = document.querySelector(s);
      return el ? getComputedStyle(el).filter : 'missing';
    }, selector);
  until.describe = async () =>
    `name=${await filterOf('[role="listitem"] span[title="Alice Johnson"]')} msg=${await filterOf('#main [role="row"]')} photo=${await filterOf('#main img.photo')}`;
  const hideReason = () => wa.evaluate(() => document.documentElement.getAttribute('data-frost-hide'));
  const away = () => wa.mouse.move(700, 450); // empty conversation background

  const NAME = '[role="listitem"] span[title="Alice Johnson"]';
  const PREVIEW = '[role="listitem"] span[title="Running late, see you at 11"]';
  const NAME_ONLY = '[role="listitem"] span[title="Omar Farooq"]';
  const AVATAR = '[role="listitem"] img';
  const MESSAGE = '#main [role="row"]';
  const PHOTO = '#main img.photo';
  const EMOJI = '#main img.emoji';

  console.log('\nBlur');

  await check('settings become attributes and CSS variables on <html>', async () => {
    const s = await wa.evaluate(() => ({
      attrs: document.documentElement.getAttributeNames().filter((n) => n.startsWith('data-frost')),
      text: document.documentElement.style.getPropertyValue('--frost-text'),
      media: document.documentElement.style.getPropertyValue('--frost-media'),
    }));
    for (const a of ['data-frost', 'data-frost-ready', 'data-frost-names', 'data-frost-previews', 'data-frost-avatars', 'data-frost-header', 'data-frost-hover', 'data-frost-gray']) {
      assert(s.attrs.includes(a), `missing ${a}`);
    }
    assert(!s.attrs.includes('data-frost-messages'), 'messages should be off by default');
    assert(s.text === '6px' && s.media === '14px', JSON.stringify(s));
  });

  await check('names, previews, photos and the chat header are blurred by default', async () => {
    assert((await filterOf(NAME)) === 'blur(6px)', `name: ${await filterOf(NAME)}`);
    assert((await filterOf(PREVIEW)) === 'blur(6px)', `preview: ${await filterOf(PREVIEW)}`);
    assert((await filterOf(AVATAR)) === 'blur(14px) grayscale(1)', `avatar: ${await filterOf(AVATAR)}`);
    assert((await filterOf('#main header span[title="Alice Johnson"]')) === 'blur(6px)', 'header name');
    assert((await filterOf('#main header img')).startsWith('blur(14px)'), 'header photo');
    assert((await filterOf(MESSAGE)) === 'none', 'messages are off by default');
    assert((await filterOf('#main footer [contenteditable]')) === 'none', 'typing box is off by default');
  });

  await check('chat-list photos are blurred wherever they are loaded from', async () => {
    const found = await wa.evaluate(() =>
      [...document.querySelectorAll('#pane-side [role="listitem"] img')].map((img) => [img.src.slice(0, 22), getComputedStyle(img).filter]),
    );
    assert(found.some(([src]) => src.startsWith('data:')) && found.some(([src]) => src.startsWith('blob:')), 'mock lacks mixed sources');
    const bare = found.filter(([, f]) => f !== 'blur(14px) grayscale(1)');
    assert(bare.length === 0, `not blurred: ${JSON.stringify(bare)}`);
  });

  await check('times and unread badges stay readable', async () => {
    assert((await filterOf('._ak8i')) === 'none', 'time blurred');
    assert((await filterOf('.badge')) === 'none', 'badge blurred');
  });

  await check('CSS alone tells names from previews', async () => {
    await setSettings({ names: false });
    await until(async () => (await filterOf(NAME)) === 'none', 'name still blurred with names off');
    assert((await filterOf(PREVIEW)) === 'blur(6px)', 'preview lost its blur');
    await setSettings({ names: true, previews: false });
    await until(async () => (await filterOf(PREVIEW)) === 'none', 'preview still blurred with previews off');
    assert((await filterOf(NAME)) === 'blur(6px)', 'name lost its blur');
    await setSettings({ previews: true });
  });

  await check('a row with only a name still counts as a name', async () => {
    assert((await filterOf(NAME_ONLY)) === 'blur(6px)', await filterOf(NAME_ONLY));
  });

  await check('a chat added later is blurred before it is painted', async () => {
    const seen = await wa.evaluate(
      () =>
        new Promise((resolve) => {
          window.__addChat('New Person', 'hello there');
          const span = document.querySelector('[role="listitem"] span[title="New Person"]');
          requestAnimationFrame(() => resolve(getComputedStyle(span).filter));
        }),
    );
    assert(seen === 'blur(6px)', seen);
  });

  await check('hovering a chat reveals only that chat, after the delay', async () => {
    try {
      await wa.hover(NAME);
      await sleep(100);
      const early = await filterOf(NAME);
      assert(early === 'blur(6px)', `revealed before the 250 ms delay: ${early}`);
      await until(async () => (await filterOf(NAME)) === 'none', 'hovered name stayed blurred');
      assert((await filterOf('[role="listitem"] span[title="Finance team"]')) === 'blur(6px)', 'other chat revealed');
    } finally {
      await away();
    }
    await until(async () => (await filterOf(NAME)) === 'blur(6px)', 'name did not re-blur');
  });

  console.log('\nOpen chat');

  const shown = () => wa.evaluate(() => document.getElementById('main').hasAttribute('data-frost-shown'));
  const clicks = () => wa.evaluate(() => window.__clicks);
  const COMPOSER = '#main footer [contenteditable]';
  const CONVO = '#main [role="application"]';

  await check('the open chat starts blurred, with no label over it', async () => {
    assert((await filterOf('#main > header')) === 'blur(12px)', `header: ${await filterOf('#main > header')}`);
    assert((await filterOf('#main > footer')) === 'blur(12px)', 'typing box area not blurred');
    assert((await filterOf('#side')) === 'none', 'chat list blurred as a whole');
    const label = await wa.evaluate(() => getComputedStyle(document.getElementById('app'), '::after').content);
    assert(label === 'none', `label showing: ${label}`);
  });

  await check('clicking the chat shows it; that click goes no further, the next one does', async () => {
    const before = await clicks();
    await wa.mouse.click(800, 400);
    await until(shown, 'not shown after click');
    assert((await filterOf('#main > header')) === 'none', 'still blurred');
    assert((await clicks()) === before, 'the revealing click reached WhatsApp');
    await wa.mouse.click(800, 400);
    assert((await clicks()) === before + 1, 'later clicks are blocked');
  });

  await check('opening another chat from the list blurs it again', async () => {
    await wa.click('[role="listitem"] span[title="Finance team"]');
    assert(!(await shown()), 'still shown');
    assert((await filterOf('#main > header')) === 'blur(12px)', 'not blurred');
    await away();
  });

  await check('typing shows the chat, and the keys still arrive', async () => {
    const draft = await wa.textContent(COMPOSER);
    await wa.focus(COMPOSER); // WhatsApp focuses the box when a chat opens; that alone must not show it
    assert(!(await shown()), 'focusing the typing box showed the chat');
    await wa.keyboard.type('ok');
    await until(shown, 'typing did not show the chat');
    const after = await wa.textContent(COMPOSER);
    assert(after.length === draft.length + 2 && after.includes('ok'), `typed text lost: "${after}"`);
  });

  await check('clicking into the typing box shows the chat and is not swallowed', async () => {
    await wa.click('[role="listitem"] span[title="Dr. Rahman"]');
    await away();
    assert(!(await shown()), 'not blurred again');
    const before = await clicks();
    await wa.click(COMPOSER);
    await until(shown, 'not shown');
    assert((await clicks()) === before + 1, 'click into the typing box was swallowed');
  });

  await check('a chat opened in a fresh panel starts blurred before it is painted', async () => {
    assert(await shown(), 'precondition: shown');
    const seen = await wa.evaluate(
      () =>
        new Promise((resolve) => {
          window.__switchChat();
          requestAnimationFrame(() => resolve(getComputedStyle(document.querySelector('#main > header')).filter));
        }),
    );
    assert(seen === 'blur(12px)', seen);
  });

  await check('blurs again after the chat is left alone, if chosen', async () => {
    await setSettings({ chatRehide: 2 });
    await wa.mouse.click(800, 400);
    await until(shown, 'not shown');
    await until(async () => !(await shown()), 'did not blur again', 5000);
    await setSettings({ chatRehide: 0 });
  });

  await check('blurs again when the mouse leaves it, if chosen', async () => {
    await setSettings({ chatRehideOnLeave: true });
    await wa.mouse.click(800, 400);
    await until(shown, 'not shown');
    await wa.mouse.move(160, 600); // over the chat list
    await until(async () => !(await shown()), 'did not blur on leave');
    await setSettings({ chatRehideOnLeave: false });
  });

  await check('with the option off, the chat is left alone', async () => {
    await setSettings({ chatWindow: false });
    await until(async () => (await filterOf('#main > header')) === 'none', 'still blurred');
    const before = await clicks();
    await wa.mouse.click(800, 400);
    assert((await clicks()) === before + 1, 'click swallowed with the option off');
    await setSettings({ chatWindow: true });
    await until(async () => (await filterOf('#main > header')) === 'blur(12px)', 'not blurred when turned back on');
  });

  const popup = await context.newPage();
  watch(popup);
  await popup.setViewportSize({ width: 360, height: 640 });
  await popup.goto(extUrl('src/popup/popup.html'));

  console.log('\nPopup');

  await check('shows live status from the WhatsApp tab', async () => {
    await until(async () => /chats in view/.test(await popup.textContent('#status')), 'status never arrived');
    assert((await popup.textContent('#status')).includes('5 chats'), await popup.textContent('#status'));
  });

  const slide = (id, value) =>
    popup.evaluate(
      ([id, value]) => {
        const input = document.getElementById(id);
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      },
      [id, value],
    );

  await check('text and photo sliders change the blur live', async () => {
    await slide('textBlur', 12);
    await until(async () => (await filterOf(NAME)) === 'blur(12px)', 'text slider not applied');
    await slide('mediaBlur', 30);
    await until(async () => (await filterOf(AVATAR)) === 'blur(30px) grayscale(1)', 'photo slider not applied');
    await slide('chatBlur', 25);
    await until(async () => (await filterOf('#main > header')) === 'blur(25px)', 'open-chat slider not applied');
    assert((await popup.textContent('#textBlur-out')) === '12 px', 'readout');
  });

  await check('the popup preview follows the sliders', async () => {
    assert((await filterOf('.pv-name', popup)) === 'blur(12px)', await filterOf('.pv-name', popup));
    assert((await filterOf('.pv-photo', popup)).startsWith('blur(30px)'), await filterOf('.pv-photo', popup));
    assert((await filterOf('.pv-time', popup)) === 'none', 'preview time blurred');
  });

  await check('presets set both sliders', async () => {
    await popup.click('#presets button[data-preset="strong"]');
    await until(async () => (await filterOf(NAME)) === 'blur(10px)', 'strong text');
    await until(async () => (await filterOf(AVATAR)).startsWith('blur(24px)'), 'strong photo');
    await until(async () => (await filterOf('#main > header')) === 'blur(20px)', 'strong open chat');
    assert((await popup.getAttribute('#presets [data-preset="strong"]', 'aria-pressed')) === 'true', 'preset not marked');
    await popup.click('#presets button[data-preset="medium"]');
    await until(async () => (await filterOf(NAME)) === 'blur(6px)', 'medium text');
  });

  await check('strength dials pick which blur the slider moves', async () => {
    await popup.click('.dial[data-dial="mediaBlur"]');
    const state = await popup.evaluate(() => ({
      visible: ['textBlur', 'mediaBlur', 'chatBlur'].filter((id) => !document.getElementById(id).hidden),
      selected: document.querySelector('.dial[aria-selected="true"]').dataset.dial,
      max: document.getElementById('slider-max').textContent,
    }));
    assert(JSON.stringify(state.visible) === '["mediaBlur"]', `visible: ${state.visible}`);
    assert(state.selected === 'mediaBlur' && state.max === '40', JSON.stringify(state));
    await popup.focus('.dial[data-dial="mediaBlur"]');
    await popup.keyboard.press('ArrowRight');
    assert(!(await popup.evaluate(() => document.getElementById('chatBlur').hidden)), 'arrow key did not move to Open chat');
    await popup.click('.dial[data-dial="textBlur"]');
    assert((await popup.evaluate(() => document.getElementById('slider-max').textContent)) === '20', 'text range');
  });

  await check('nothing makes Chrome widen the popup past 360 px', async () => {
    // Chrome sizes a popup to its content, overflow included: a decoration poking out widens it.
    const w = await popup.evaluate(() => document.documentElement.scrollWidth);
    assert(w <= 360, `content is ${w}px wide`);
  });

  await check('the popup fits Chrome\'s 600 px popup height', async () => {
    const h = await popup.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
    assert(h <= 600, `popup is ${h}px tall`);
  });

  await check('"Whole open chat" switch in the popup', async () => {
    await popup.click('label.lead');
    await until(async () => (await filterOf('#main > header')) === 'none', 'still blurred after switching off');
    await popup.click('label.lead');
    await until(async () => (await filterOf('#main > header')) === 'blur(12px)', 'not blurred after switching on');
  });

  await check('messages and media toggles; emoji are not media', async () => {
    await popup.click('label.chip:has([data-key="messages"])');
    await popup.click('label.chip:has([data-key="media"])');
    await until(async () => (await filterOf(MESSAGE)) === 'blur(6px)', 'messages not blurred');
    await until(async () => (await filterOf(PHOTO)).startsWith('blur(14px)'), 'photo not blurred');
    assert((await filterOf(EMOJI)) === 'none', 'emoji treated as media');
  });

  await check('hovering a message reveals it and its photo', async () => {
    try {
      await wa.locator(MESSAGE).nth(2).hover();
      await until(async () => (await filterOf(PHOTO)) === 'none', 'photo stayed blurred on hover');
    } finally {
      await away();
    }
  });

  await check('master switch turns everything off and on', async () => {
    await popup.click('#enabled');
    await until(async () => (await filterOf(NAME)) === 'none', 'still blurred when off');
    assert((await filterOf(MESSAGE)) === 'none', 'messages still blurred when off');
    await popup.click('#enabled');
    await until(async () => (await filterOf(NAME)) === 'blur(6px)', 'not blurred after on');
  });

  if (SHOTS) {
    await away();
    await sleep(300);
    await wa.screenshot({ path: path.join(SHOTS, 'whatsapp-blurred.png') });
  }

  console.log('\nHide the whole window');

  await check('"Hide window" hides everything and blocks clicks', async () => {
    await popup.click('#hide');
    await until(async () => (await hideReason()) === 'manual', 'not hidden');
    assert((await filterOf('#app')) === 'blur(28px) grayscale(1)', await filterOf('#app'));
    assert((await popup.textContent('#hide')) === 'Show window', 'button text');
    const before = await wa.evaluate(() => window.__clicks);
    await wa.mouse.click(160, 130);
    await until(async () => (await hideReason()) === null, 'click did not show the window');
    assert((await wa.evaluate(() => window.__clicks)) === before, 'the click reached WhatsApp');
    assert((await worker.evaluate(() => chrome.storage.local.get('hidden'))).hidden === false, 'hidden flag not cleared');
  });

  if (SHOTS) {
    await worker.evaluate(() => chrome.storage.local.set({ hidden: true }));
    await until(async () => (await hideReason()) === 'manual', 'not hidden');
    await sleep(250);
    await wa.screenshot({ path: path.join(SHOTS, 'hidden-light.png') });
    await wa.emulateMedia({ colorScheme: 'dark' });
    await sleep(100);
    await wa.screenshot({ path: path.join(SHOTS, 'hidden-dark.png') });
    await wa.emulateMedia({ colorScheme: 'light' });
    await worker.evaluate(() => chrome.storage.local.set({ hidden: false }));
    await until(async () => (await hideReason()) === null, 'not shown');
  }

  await check('"Hide window" also covers modal dialogs in the top layer', async () => {
    await wa.evaluate(() => {
      const d = document.createElement('dialog');
      d.id = 'frost-test-dialog';
      d.append('Modal');
      document.body.append(d);
      d.showModal();
    });
    assert((await filterOf('#frost-test-dialog')) === 'none', 'dialog blurred while shown');
    await worker.evaluate(() => chrome.storage.local.set({ hidden: true }));
    await until(async () => (await hideReason()) === 'manual', 'not hidden');
    assert((await filterOf('#frost-test-dialog')) === 'blur(28px) grayscale(1)', await filterOf('#frost-test-dialog'));
    await wa.evaluate(() => document.getElementById('frost-test-dialog').remove());
    await worker.evaluate(() => chrome.storage.local.set({ hidden: false }));
    await until(async () => (await hideReason()) === null, 'not shown');
  });

  await check('Esc shows the window, other keys never reach WhatsApp', async () => {
    await worker.evaluate(() => chrome.storage.local.set({ hidden: true }));
    await until(async () => (await hideReason()) === 'manual', 'not hidden');
    await wa.focus('#main footer [contenteditable]');
    const draft = await wa.textContent('#main footer [contenteditable]');
    await wa.keyboard.type('xyz');
    assert((await wa.textContent('#main footer [contenteditable]')) === draft, 'typed into WhatsApp while hidden');
    await wa.keyboard.press('Escape');
    await until(async () => (await hideReason()) === null, 'Esc did not show the window');
  });

  await check('hides after inactivity and comes back on click', async () => {
    await setSettings({ hideAfterIdle: 2 }); // the settings page offers 30 s and up; 2 s keeps the test short
    await until(async () => (await hideReason()) === 'idle', 'never hid', 5000);
    await wa.mouse.click(640, 380);
    await until(async () => (await hideReason()) === null, 'click did not show');
    await setSettings({ hideAfterIdle: 0 });
  });

  await check('hides when WhatsApp goes to the background, not while the popup is open', async () => {
    await setSettings({ hideWhenAway: true });
    const cdp = await context.newCDPSession(wa);
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    const other = await context.newPage();
    try {
      await other.goto('about:blank');
      await other.bringToFront();
      await sleep(300);
      // Chromium under Playwright keeps the tab focused (headless, and headed under WSLg), so the
      // real trigger cannot fire here.
      if (await wa.evaluate(() => document.hasFocus())) skip('Chromium under automation keeps the tab focused; check by hand in Chrome');

      // The open popup pings the tab, which keeps it visible while you adjust settings.
      await wa.evaluate(() => window.dispatchEvent(new Event('blur')));
      await sleep(900);
      assert((await hideReason()) === null, 'hid while the popup was open');

      await popup.goto('about:blank');
      await sleep(1700); // let the popup grace period run out
      await wa.evaluate(() => window.dispatchEvent(new Event('blur')));
      await until(async () => (await hideReason()) === 'away', 'did not hide');
      await wa.bringToFront();
      await until(async () => (await hideReason()) === null, 'did not come back on focus');
    } finally {
      await other.close();
      await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
      await cdp.detach();
      await setSettings({ hideWhenAway: false });
      if (popup.url() === 'about:blank') await popup.goto(extUrl('src/popup/popup.html'));
    }
  });

  console.log('\nSettings page');

  const options = await context.newPage();
  watch(options);
  await options.goto(extUrl('src/options/options.html'));

  await check('black-and-white photos can be turned off', async () => {
    await options.click('li:has(#grayscale) .switch');
    await until(async () => (await filterOf(AVATAR)) === 'blur(14px) grayscale(0)', await filterOf(AVATAR));
    await options.click('li:has(#grayscale) .switch');
  });

  await check('"Blur the open chat" switch on the settings page', async () => {
    await options.click('li:has(#chatWindow) .switch');
    await until(async () => (await filterOf('#main > header')) === 'none', 'still blurred after switching off');
    await until(() => options.evaluate(() => document.getElementById('chat-rows').hasAttribute('data-inactive')), 'sub-options not dimmed');
    await options.click('li:has(#chatWindow) .switch');
    await until(async () => (await filterOf('#main > header')) === 'blur(12px)', 'not blurred after switching on');
  });

  await check('open-chat options are saved', async () => {
    await options.selectOption('#chatRehide', '30');
    await options.click('li:has(#chatLeave) .switch');
    await until(async () => {
      const { settings } = await worker.evaluate(() => chrome.storage.local.get('settings'));
      return settings.chatRehide === 30 && settings.chatRehideOnLeave === true;
    }, 'not saved');
    await options.selectOption('#chatRehide', '0');
    await options.click('li:has(#chatLeave) .switch');
  });

  await check('reveal delay slider feeds the CSS variable', async () => {
    await options.evaluate(() => {
      const input = document.getElementById('revealDelay');
      input.value = 600;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await until(
      () => wa.evaluate(() => document.documentElement.style.getPropertyValue('--frost-reveal-delay') === '600ms'),
      'delay not applied',
    );
  });

  await check('out-of-range values are clamped before they reach CSS', async () => {
    await worker.evaluate(() => chrome.storage.local.set({ settings: { textBlur: 9999, mediaBlur: 'url(x)', revealDelay: -5 } }));
    await until(
      () =>
        wa.evaluate(() => {
          const s = document.documentElement.style;
          return s.getPropertyValue('--frost-text') === '20px' && s.getPropertyValue('--frost-media') === '14px' && s.getPropertyValue('--frost-reveal-delay') === '0ms';
        }),
      'values not clamped',
    );
  });

  await check('restore defaults', async () => {
    await options.click('#reset');
    await until(async () => (await filterOf(NAME)) === 'blur(6px)', 'defaults not restored');
    assert((await filterOf(MESSAGE)) === 'none', 'messages still on after reset');
  });

  if (SHOTS) {
    await options.reload();
    await options.setViewportSize({ width: 900, height: 1200 });
    await options.screenshot({ path: path.join(SHOTS, 'options-light.png'), fullPage: true });
    await options.emulateMedia({ colorScheme: 'dark' });
    await options.screenshot({ path: path.join(SHOTS, 'options-dark.png'), fullPage: true });
    await popup.reload();
    await sleep(600);
    await popup.locator('body').screenshot({ path: path.join(SHOTS, 'popup-light.png') });
    await popup.emulateMedia({ colorScheme: 'dark' });
    await sleep(100);
    await popup.locator('body').screenshot({ path: path.join(SHOTS, 'popup-dark.png') });
  }

  console.log('\nHygiene');

  await check('no request leaves the machine', async () => {
    const allowed = /^(chrome-extension:|data:|blob:|about:|https:\/\/web\.whatsapp\.com\/|https:\/\/pps\.whatsapp\.net\/)/;
    const other = requests.filter((u) => !allowed.test(u));
    assert(other.length === 0, other.join(', '));
  });

  await check('no errors in WhatsApp, the popup or the settings page', async () => {
    assert(pageErrors.length === 0, pageErrors.join(' / '));
  });

  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });

  const failed = results.filter((r) => r[0] === 'FAIL');
  const skipped = results.filter((r) => r[0] === 'skip');
  const passed = results.length - failed.length - skipped.length;
  console.log(`\n${passed} passed, ${failed.length} failed, ${skipped.length} skipped`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(2);
});
