// Content script for web.whatsapp.com (isolated world, document_start).
//
// Its whole job is to translate settings into attributes and CSS variables on <html>, which
// frost.css turns into blur. It never reads text, attributes or images from WhatsApp's page,
// never runs code in WhatsApp's own JavaScript, and has nothing to send anywhere.
//
// It also listens for focus, visibility, click and input *events* (never their contents) to hide
// the whole window when WhatsApp goes to the background or sits idle, and to show the open chat
// when you click it or start typing.

(function () {
  'use strict';

  const { TARGETS, clean } = self.Frost;
  const root = document.documentElement;

  let settings = clean();
  let hiddenByShortcut = false; // Alt+X or the popup button; shared by every WhatsApp tab
  let away = false;
  let idle = false;
  let lastActivity = Date.now();
  let lastPopupPing = 0;
  let awayTimer = 0;

  // ── Settings → <html> ──────────────────────────────────────────────────────

  function flag(name, on) {
    if (on) {
      if (!root.hasAttribute(name)) root.setAttribute(name, '');
    } else if (root.hasAttribute(name)) {
      root.removeAttribute(name);
    }
  }

  function apply() {
    flag('data-frost', settings.enabled);
    flag('data-frost-chat', settings.chatWindow);
    for (const target of TARGETS) flag(`data-frost-${target}`, settings[target]);
    flag('data-frost-hover', settings.hoverReveal);
    flag('data-frost-gray', settings.grayscale);
    // clean() has already clamped these to numbers.
    root.style.setProperty('--frost-chat', `${settings.chatBlur}px`);
    root.style.setProperty('--frost-text', `${settings.textBlur}px`);
    root.style.setProperty('--frost-media', `${settings.mediaBlur}px`);
    root.style.setProperty('--frost-reveal-delay', `${settings.revealDelay}ms`);
    applyHide();
  }

  function applyHide() {
    const reason = hiddenByShortcut ? 'manual' : away ? 'away' : idle ? 'idle' : '';
    if (reason) {
      if (root.getAttribute('data-frost-hide') !== reason) root.setAttribute('data-frost-hide', reason);
    } else {
      root.removeAttribute('data-frost-hide');
    }
  }

  chrome.storage.local
    .get(['settings', 'hidden'])
    .then((stored) => {
      settings = clean(stored.settings);
      hiddenByShortcut = stored.hidden === true;
    })
    .catch(() => {})
    .finally(() => {
      apply();
      root.setAttribute('data-frost-ready', '');
    });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) {
      settings = clean(changes.settings.newValue);
      if (!settings.hideWhenAway) away = false;
      if (!settings.hideAfterIdle) idle = false;
    }
    if (changes.hidden) hiddenByShortcut = changes.hidden.newValue === true;
    apply();
  });

  // ── Showing the window again ───────────────────────────────────────────────
  // While hidden, clicks and keys are stopped before WhatsApp sees them, so nothing is opened or
  // typed blind. A click (or Esc) shows the window.

  const isHidden = () => root.hasAttribute('data-frost-hide');

  function show() {
    if (hiddenByShortcut) chrome.storage.local.set({ hidden: false }).catch(() => {});
    hiddenByShortcut = false;
    away = false;
    idle = false;
    lastActivity = Date.now();
    applyHide();
  }

  function swallow(event) {
    if (!isHidden()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  for (const type of ['pointerdown', 'mousedown', 'mouseup', 'dblclick', 'contextmenu', 'keypress', 'keyup']) {
    window.addEventListener(type, swallow, true);
  }
  window.addEventListener(
    'click',
    (event) => {
      if (!isHidden()) return;
      swallow(event);
      show();
    },
    true,
  );
  window.addEventListener(
    'keydown',
    (event) => {
      if (!isHidden()) return;
      swallow(event);
      if (event.key === 'Escape') show();
    },
    true,
  );

  // ── The open chat ──────────────────────────────────────────────────────────
  // The chat panel (#main) stays blurred until you click it or type. The "shown" marker is an
  // attribute on #main itself: if WhatsApp builds a fresh panel for the next chat, it arrives
  // without the marker and frost.css blurs it before it is painted. If WhatsApp reuses the panel,
  // pressing a chat in the list removes the marker.

  const ROW = '[role="listitem"], [role="row"]';
  const COMPOSER = 'footer [contenteditable="true"]';
  let lastChatActivity = 0;

  const asElement = (node) => (node instanceof Element ? node : null);
  const chatPanel = (node) => {
    const el = asElement(node);
    return el ? el.closest('#main') : null;
  };
  const chatBlurred = (main) => !!main && settings.enabled && settings.chatWindow && !main.hasAttribute('data-frost-shown');

  function showChat(main) {
    if (!main.hasAttribute('data-frost-shown')) main.setAttribute('data-frost-shown', '');
    lastChatActivity = Date.now();
  }

  function blurChat() {
    const main = document.getElementById('main');
    if (main && main.hasAttribute('data-frost-shown')) main.removeAttribute('data-frost-shown');
  }

  // Pressing a chat in the list (mouse, or Enter on a focused row) blurs the chat it opens.
  // Runs on pointerdown, before WhatsApp swaps the conversation in.
  function opensChat(event) {
    const el = asElement(event.target);
    if (el && !el.closest('#main') && el.closest(ROW)) blurChat();
  }
  window.addEventListener('pointerdown', opensChat, true);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !isHidden()) opensChat(event);
  }, true);

  // A press on the blurred chat shows it and goes no further, so nothing you could not see gets
  // opened or selected. The typing box is the exception: the click focuses it as usual.
  function pressOnChat(event) {
    if (isHidden()) return;
    const main = chatPanel(event.target);
    if (!chatBlurred(main)) return;
    if (asElement(event.target).closest(COMPOSER)) {
      if (event.type === 'click') showChat(main);
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === 'click') showChat(main);
  }
  for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick']) {
    window.addEventListener(type, pressOnChat, true);
  }

  // Typing shows it. WhatsApp sends keys typed anywhere into the chat's typing box, so this also
  // covers starting to type without clicking first.
  window.addEventListener(
    'beforeinput',
    (event) => {
      const main = chatPanel(event.target);
      if (chatBlurred(main)) showChat(main);
    },
    true,
  );

  // Optional: blur again once the chat has been left alone, or when the mouse leaves it.
  const chatActivity = (event) => {
    if (settings.chatRehide && chatPanel(event.target)) lastChatActivity = Date.now();
  };
  for (const type of ['mousemove', 'keydown', 'wheel', 'pointerdown']) {
    window.addEventListener(type, chatActivity, { capture: true, passive: true });
  }

  document.addEventListener(
    'mouseout',
    (event) => {
      if (!settings.chatWindow || !settings.chatRehideOnLeave) return;
      if (chatPanel(event.target) && !chatPanel(event.relatedTarget)) blurChat();
    },
    true,
  );

  setInterval(() => {
    if (!settings.chatWindow || !settings.chatRehide) return;
    if (Date.now() - lastChatActivity >= settings.chatRehide * 1000) blurChat();
  }, 1000);

  // ── Hide when WhatsApp is not in front ─────────────────────────────────────
  // Opening Frost's own popup also takes focus from the page; the popup pings this tab as it
  // opens, so a short grace period keeps the page visible while you adjust settings.

  window.addEventListener('blur', () => {
    if (!settings.hideWhenAway) return;
    clearTimeout(awayTimer);
    awayTimer = setTimeout(() => {
      if (!document.hasFocus() && Date.now() - lastPopupPing > 1500) {
        away = true;
        applyHide();
      }
    }, 400);
  });

  window.addEventListener('focus', () => {
    clearTimeout(awayTimer);
    if (away) {
      away = false;
      applyHide();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && settings.hideWhenAway) {
      // Also keeps tab-hover previews and taskbar thumbnails blurred.
      away = true;
      applyHide();
    } else if (!document.hidden && document.hasFocus() && away) {
      away = false;
      applyHide();
    }
  });

  // ── Hide after inactivity ──────────────────────────────────────────────────
  // Only the time of the last mouse or keyboard event is kept, in memory.

  const markActive = () => {
    lastActivity = Date.now();
  };
  for (const type of ['mousemove', 'pointerdown', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(type, markActive, { capture: true, passive: true });
  }

  setInterval(() => {
    const limit = settings.hideAfterIdle * 1000;
    if (!limit || idle || document.hidden) return;
    if (Date.now() - lastActivity >= limit) {
      idle = true;
      applyHide();
    }
  }, 1000);

  // ── Status for the popup ───────────────────────────────────────────────────
  // Counts chat rows so the popup can warn when WhatsApp changes its layout. Reads no content.

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only Frost's own pages may ask (not a content script running in some web page).
    const fromOwnPage = sender.id === chrome.runtime.id && String(sender.url || '').startsWith(chrome.runtime.getURL(''));
    if (!fromOwnPage || !message || message.type !== 'status') return false;
    lastPopupPing = Date.now();
    const pane = document.getElementById('pane-side');
    const rows = pane ? pane.querySelectorAll('[role="listitem"]').length || pane.querySelectorAll('[role="row"]').length : 0;
    sendResponse({ signedIn: !!pane, rows, hidden: root.getAttribute('data-frost-hide') || '' });
    return false;
  });
})();
