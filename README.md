# Frost

Blur for WhatsApp Web. Every blur is a plain CSS property change, made locally in your browser. There is no password, no account, no network access and no code running inside WhatsApp.

## Install

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose `C:\Users\user\Projects\frost\extension`.
3. Pin Frost from the puzzle-piece menu.
4. Reload WhatsApp Web if it was already open.

## What it does

**Whole open chat** (on by default; switch in the popup and in More settings): the conversation that opens when you click a contact stays blurred.
- **Clicking anywhere on it** shows it. That first click goes no further, so you can't open a photo or link you couldn't see. Clicks on the typing box itself go straight through.
- **Typing** shows it too, including keys typed before you click anywhere.
- **Opening another chat** blurs it again.
- **Optional, in More settings:** blur it again after 15 s – 5 min with no activity in the chat, or whenever the mouse leaves it.

**Blur**: turn each one on or off in the popup.

| | Default |
|---|---|
| Chat names | on |
| Last-message previews | on |
| Profile photos | on |
| Chat header (name and status line) | on |
| Messages in the open chat | off |
| Photos, videos and stickers | off |
| Typing box | off |

Times and unread badges are never blurred.

**Adjust**: in the popup.
- **Strength:** sliders for text (1–20 px), photos (2–40 px) and the open chat (2–40 px), plus Light / Medium / Strong presets.
- **Black and white photos:** on or off, in More settings.
- **Live preview:** a sample chat at the top of the popup shows the result as you drag.
- **Reveal on hover:** on or off. The delay before revealing (0–1.5 s) is in More settings.

**Hide the whole window**: blurs everything and blocks clicks and typing until you click or press Esc.
- On demand: the popup's **Hide window** button, or `Alt+X`.
- Automatically when WhatsApp isn't in front (tab or app switch, minimise). This also keeps tab-hover previews and taskbar thumbnails blurred.
- Automatically after a set time with no mouse or keyboard use in the tab.

**Shortcuts**: `Alt+Z` turns blur on or off, and `Alt+X` hides or shows the window. Change them at `chrome://extensions/shortcuts`.

## Why it's safe

- **Permission:** only `storage`. No host permissions, no `tabs`, and no files exposed to websites.
- **No network:**
  - The extension's pages carry `connect-src 'none'`.
  - The content script runs in Chrome's isolated world, where WhatsApp's scripts can't reach it, and it never calls `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` or `postMessage`.
  - A test greps the source to keep it that way.
- **Never reads your chats:**
  - `src/content/frost.js` only sets attributes and four CSS variables on `<html>`, plus one marker attribute on the open chat panel.
  - `src/content/frost.css` does all the blurring.
  - The script notices *where* you click or type (inside the open chat, or on a chat in the list), never what's written there. Otherwise it only counts chat rows, so the popup can warn you if WhatsApp changes its layout.
  - A test fails if the script ever touches `textContent`, `innerHTML`, `.src`, `.title`, `getComputedStyle` and similar.
- **Nothing runs in WhatsApp's own JavaScript world.**
- **Settings stay in this browser:** they live in `chrome.storage.local`, which is not synced to your Google account.

## How the CSS finds things

The selectors don't use WhatsApp's generated class names, which change with every deploy. They use:
- the IDs `#app`, `#pane-side` and `#main`;
- ARIA roles (`listitem`, `row`);
- every picture inside a chat-list row (profile photos load from several addresses, so the address isn't used);
- the footer's `contenteditable`;
- the shape of a chat row.

In a chat row, a titled span whose ancestor follows a sibling that also holds a titled span is on the second line, which makes it the preview. Every other titled span is the name. `:has()` expresses that in CSS alone, so new chats are blurred before they're ever painted.

For the open chat, the "shown" marker lives on the `#main` element itself:
- If WhatsApp builds a fresh panel for the next chat, it arrives without the marker and is blurred before it's painted.
- If WhatsApp reuses the panel, pressing a chat in the list (pointer down, or Enter) removes the marker before WhatsApp swaps the conversation in.

## When WhatsApp changes its layout

If the popup says *"No chats recognised"* while you're signed in, run this in the DevTools console on web.whatsapp.com. It copies the shape of one chat row with no text in it:

```js
(() => {
  const strip = (el, depth = 0) => depth > 7 ? '' :
    `${'  '.repeat(depth)}<${el.tagName.toLowerCase()}${[...el.attributes]
      .filter(a => ['id','role','title','dir','data-icon','contenteditable','src'].includes(a.name))
      .map(a => ` ${a.name}${a.name === 'title' ? `="…${a.value.length}"` : a.name === 'src' ? `="${a.value.split('/')[2] || a.value.slice(0, 5)}"` : `="${a.value}"`}`).join('')}>\n` +
    [...el.children].map(c => strip(c, depth + 1)).join('');
  const row = document.querySelector('#pane-side [role]');
  copy(strip(row?.closest('[role="listitem"],[role="row"]') || document.querySelector('#pane-side')));
  return 'Copied the structure of one chat row (no text) to the clipboard';
})();
```

Then adjust the selectors in `src/content/frost.css`.

## Limits

- Blur is visual. It stops people reading over your shoulder; it does not encrypt anything.
- Desktop notifications are WhatsApp's own and are not changed. Turn off message previews in WhatsApp's notification settings if that matters to you.

## Tests

`test/e2e.cjs` makes these checks:
1. Static checks: permissions, banned network APIs, and no page-reading in the content script.
2. It loads the unpacked extension into Chromium and serves a WhatsApp-shaped page at `https://web.whatsapp.com`, under a stricter CSP than the real one.
3. It drives the popup and the settings page.

```sh
PLAYWRIGHT=/path/to/node_modules/playwright node test/e2e.cjs [screenshot-dir]
```

On WSL without sudo, Playwright's Chromium is missing NSS and ALSA. Fetch them without installing:

```sh
mkdir -p ~/.cache/pw-libs && cd /tmp && apt-get download libnspr4 libnss3 libasound2t64 \
  && for d in lib*.deb; do dpkg -x "$d" ~/.cache/pw-libs; done
export LD_LIBRARY_PATH=~/.cache/pw-libs/usr/lib/x86_64-linux-gnu
```

The "hide when WhatsApp isn't in front" check is skipped under automation, because Chromium driven by Playwright keeps the tab focused. Check it by hand: turn it on, switch to another app, and come back.

The mock mirrors WhatsApp's landmarks, not its exact markup. After any big WhatsApp redesign, check the real page by eye.

Fonts: Geist and Geist Mono, SIL Open Font License (`extension/fonts/OFL.txt`), used only in Frost's own popup and settings page.
