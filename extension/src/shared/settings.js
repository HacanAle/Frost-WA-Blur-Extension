// Settings schema, shared by the service worker, the content script and the extension pages.
// A classic script on purpose: content scripts cannot be ES modules.
// Everything lives in chrome.storage.local, which never leaves this computer (unlike .sync).

(function (root) {
  'use strict';

  // What can be blurred, in the order the popup shows them.
  const TARGETS = ['names', 'previews', 'avatars', 'header', 'messages', 'media', 'input'];

  const DEFAULTS = Object.freeze({
    enabled: true,

    // The open conversation stays blurred until you click it or type.
    chatWindow: true,
    chatBlur: 12, // px
    chatRehide: 0, // seconds without activity in the chat before it blurs again, 0 = never
    chatRehideOnLeave: false,

    names: true,
    previews: true,
    avatars: true,
    header: true,
    messages: false,
    media: false,
    input: false,

    textBlur: 6, // px
    mediaBlur: 14, // px
    grayscale: true,

    hoverReveal: true,
    revealDelay: 250, // ms

    hideWhenAway: false,
    hideAfterIdle: 0, // seconds, 0 = never
  });

  // Every number is clamped on the way in and on the way out, so nothing but a sane number ever
  // reaches a CSS property.
  const LIMITS = Object.freeze({
    chatBlur: [2, 40],
    chatRehide: [0, 3600],
    textBlur: [1, 20],
    mediaBlur: [2, 40],
    revealDelay: [0, 1500],
    hideAfterIdle: [0, 3600],
  });

  const PRESETS = Object.freeze({
    light: { textBlur: 4, mediaBlur: 8, chatBlur: 8 },
    medium: { textBlur: 6, mediaBlur: 14, chatBlur: 12 },
    strong: { textBlur: 10, mediaBlur: 24, chatBlur: 20 },
  });

  function clean(stored) {
    const out = {};
    for (const [key, fallback] of Object.entries(DEFAULTS)) {
      let value = stored ? stored[key] : undefined;
      if (typeof value !== typeof fallback || (typeof value === 'number' && !Number.isFinite(value))) value = fallback;
      if (LIMITS[key]) value = Math.round(Math.min(LIMITS[key][1], Math.max(LIMITS[key][0], value)));
      out[key] = value;
    }
    return out;
  }

  async function load() {
    const { settings } = await chrome.storage.local.get('settings');
    return clean(settings);
  }

  async function save(changes) {
    const next = clean(Object.assign(await load(), changes));
    await chrome.storage.local.set({ settings: next });
    return next;
  }

  root.Frost = Object.freeze({ TARGETS, DEFAULTS, LIMITS, PRESETS, clean, load, save });
})(self);
