// Builds the README images from raw screenshots taken by the end-to-end test.
//
//   node test/e2e.cjs shots            # raw screenshots (popup, settings, mock WhatsApp)
//   node docs/make-images.cjs shots    # composes docs/*.png from them
//
// Every image is an HTML page rendered by Chromium. The WhatsApp window is the test's mock page
// with made-up chats, never a real account.

const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.resolve(process.argv[2] || 'shots');
const OUT = __dirname;
const url = (p) => 'file://' + p.split(path.sep).join('/');
const shot = (name) => url(path.join(SHOTS, name));
const asset = (p) => url(path.join(ROOT, p));

const base = (theme) => `
  @font-face { font-family: Geist; src: url('${asset('extension/fonts/geist.woff2')}'); font-weight: 100 900; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; }
  body {
    position: relative; overflow: hidden; isolation: isolate;
    font-family: Geist, system-ui, sans-serif; -webkit-font-smoothing: antialiased;
    background: ${theme === 'dark' ? '#04190f' : '#d9ede2'};
    color: ${theme === 'dark' ? '#e3f3ea' : '#0b2a1f'};
  }
  .disc { position: absolute; z-index: -1; border-radius: 50%; }
  .deep { background: linear-gradient(210deg, ${theme === 'dark' ? '#12543b, #0b3b29' : '#1d6b4c, #0e4733'} 65%); }
  .mid { background: linear-gradient(40deg, ${theme === 'dark' ? '#0c3123, #10402e' : '#9fceb6, #bfe0cd'}); }
  .glass {
    background: ${theme === 'dark' ? 'rgba(18,54,40,.42)' : 'rgba(244,251,247,.6)'};
    backdrop-filter: blur(22px) saturate(150%);
    border: 1px solid ${theme === 'dark' ? 'rgba(200,255,225,.1)' : 'rgba(255,255,255,.72)'};
  }
  .shadow { box-shadow: 0 30px 70px -30px rgba(4, 40, 26, .55), 0 8px 20px -12px rgba(4, 40, 26, .3); }
`;

// A browser window around the mock WhatsApp page, with Frost's popup open under its toolbar icon.
const browser = (width) => `
  <div class="win glass shadow" style="width:${width}px">
    <div class="bar">
      <span class="addr">web.whatsapp.com</span>
      <img class="tool" src="${asset('extension/icons/icon.svg')}">
    </div>
    <img class="page" src="${shot('whatsapp-blurred.png')}">
    <img class="popup shadow" src="${shot('popup-light.png')}">
  </div>`;
const browserCss = (scale) => `
  .win { position: absolute; border-radius: ${14 * scale}px; overflow: visible; }
  .bar { display: flex; align-items: center; gap: 10px; height: ${44 * scale}px; padding: 0 ${14 * scale}px; }
  .addr { flex: 1; height: ${26 * scale}px; line-height: ${26 * scale}px; padding: 0 ${14 * scale}px; border-radius: 999px;
    background: rgba(255,255,255,.7); font-size: ${13 * scale}px; color: #3d6152; }
  .tool { width: ${22 * scale}px; height: ${22 * scale}px; border-radius: ${6 * scale}px; outline: 2px solid rgba(0,168,132,.5); outline-offset: 3px; }
  .page { display: block; width: 100%; border-radius: 0 0 ${14 * scale}px ${14 * scale}px; }
  .popup { position: absolute; top: ${40 * scale}px; right: ${8 * scale}px; width: ${360 * scale}px; border-radius: ${10 * scale}px; }
`;

const pages = {
  hero: {
    size: [1280, 640],
    html: `<style>${base('light')}${browserCss(0.62)}
      .copy { position: absolute; left: 72px; top: 0; bottom: 0; width: 460px; display: flex; flex-direction: column; justify-content: center; }
      .mark { width: 64px; height: 64px; border-radius: 16px; box-shadow: 0 12px 30px -14px rgba(4,40,26,.6); }
      h1 { margin-top: 22px; font-size: 104px; line-height: .95; font-weight: 250; letter-spacing: -.045em; }
      .tag { margin-top: 18px; font-size: 26px; font-weight: 400; letter-spacing: -.01em; }
      .sub { margin-top: 10px; font-size: 17px; line-height: 1.5; color: #3d6152; max-width: 400px; }
      .facts { display: flex; gap: 8px; margin-top: 26px; }
      .facts span { padding: 7px 14px; border-radius: 999px; font-size: 14px; color: #0b2a1f; }
      .win { left: 600px; top: 112px; }
    </style>
    <span class="disc deep" style="width:720px;height:720px;top:-380px;right:-200px"></span>
    <span class="disc mid" style="width:520px;height:520px;bottom:-300px;left:-140px"></span>
    <span class="disc mid" style="width:300px;height:300px;bottom:-120px;right:260px;opacity:.8"></span>
    <div class="copy">
      <img class="mark" src="${asset('extension/icons/icon.svg')}">
      <h1>Frost</h1>
      <p class="tag">Blur for WhatsApp Web.</p>
      <p class="sub">Names, previews, photos and the open chat stay frosted until you want to see them.</p>
      <div class="facts"><span class="glass">Pure CSS</span><span class="glass">One permission</span><span class="glass">Nothing sent anywhere</span></div>
    </div>
    ${browser(640)}`,
  },

  whatsapp: {
    size: [1280, 800],
    html: `<style>${base('light')}${browserCss(1)}
      .win { left: 60px; top: 40px; width: 1160px !important; }
      .popup { width: 330px; top: 44px; right: 10px; }
    </style>
    <span class="disc deep" style="width:760px;height:760px;top:-420px;right:-240px"></span>
    <span class="disc mid" style="width:560px;height:560px;bottom:-320px;left:-200px"></span>
    ${browser(1160)}`,
  },

  popup: {
    size: [1280, 720],
    html: `<style>${base('light')}
      .pair { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 56px; }
      .pair img { width: 360px; border-radius: 14px; }
      .dark-side { position: absolute; top: 0; right: 0; bottom: 0; width: 50%; background: #04190f; z-index: -1; overflow: hidden; }
    </style>
    <div class="dark-side">
      <span class="disc deep" style="width:620px;height:620px;top:-300px;right:-220px;z-index:0;background:linear-gradient(210deg,#12543b,#0b3b29 65%)"></span>
      <span class="disc" style="width:420px;height:420px;bottom:-220px;left:-80px;z-index:0;background:linear-gradient(40deg,#0c3123,#10402e)"></span>
    </div>
    <span class="disc mid" style="width:520px;height:520px;top:-240px;left:-160px"></span>
    <span class="disc deep" style="width:360px;height:360px;bottom:-240px;left:300px;z-index:-2"></span>
    <div class="pair">
      <img class="shadow" src="${shot('popup-light.png')}">
      <img class="shadow" src="${shot('popup-dark.png')}">
    </div>`,
  },

  settings: {
    size: [1280, 1000],
    html: `<style>${base('light')}
      .frame { position: absolute; left: 50%; top: 56px; width: 1000px; margin-left: -500px; height: 900px; overflow: hidden; border-radius: 16px; }
      .frame img { display: block; width: 100%; }
    </style>
    <span class="disc deep" style="width:700px;height:700px;top:-380px;left:-240px"></span>
    <span class="disc mid" style="width:560px;height:560px;bottom:-300px;right:-160px"></span>
    <div class="frame glass shadow"><img src="${shot('options-light.png')}"></div>`,
  },
};

(async () => {
  for (const f of ['whatsapp-blurred.png', 'popup-light.png', 'popup-dark.png', 'options-light.png']) {
    if (!fs.existsSync(path.join(SHOTS, f))) throw new Error(`missing ${f}: run node test/e2e.cjs ${SHOTS} first`);
  }
  const b = await chromium.launch();
  for (const [name, { size, html }] of Object.entries(pages)) {
    const page = await b.newPage({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 2 });
    const file = path.join(SHOTS, `_${name}.html`);
    fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><body>${html}</body>`);
    await page.goto(url(file));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    await page.close();
    console.log(`docs/${name}.png`);
  }
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
