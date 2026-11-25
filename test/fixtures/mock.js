// A stand-in for WhatsApp Web's DOM: the same landmarks Veil relies on (#app, #pane-side,
// role=listitem rows, span[title], pps.whatsapp.net photos, #main, role=row messages,
// .copyable-text, footer contenteditable) wrapped in WhatsApp-style generated class names.

(function () {
  const chats = [
    ['Alice Johnson', 'Running late, see you at 11', '10:42', 2],
    ['Finance team', 'Q3 numbers attached, please review', '09:15', 0],
    ['Dr. Rahman', 'Your results are ready', 'Yesterday', 1],
    ['Omar Farooq', null],
  ];

  // Profile photos arrive from different places: the pps CDN, a data: URL, a cached blob:.
  const AVATAR_SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Crect width='10' height='10' fill='%23c0392b'/%3E%3C/svg%3E";
  const avatarSrc = (i) => (i === 1 ? AVATAR_SVG : i === 2 ? photo : `https://pps.whatsapp.net/v/t61/p${i}.jpg`);

  function chatRow([name, preview, time, unread], i) {
    if (preview === null) {
      // A row with no second line, as in contact search results.
      return `
      <div role="listitem" tabindex="-1">
        <div class="_ak8n"><img src="https://pps.whatsapp.net/v/t61/p${i}.jpg" alt=""></div>
        <div class="_ak8l"><div class="_ak8o"><div class="_ak8q"><span dir="auto" title="${name}" class="x1iyjqo2 _ao3e">${name}</span></div></div></div>
      </div>`;
    }
    return `
      <div role="listitem" tabindex="-1">
        <div class="_ak8n"><img src="${avatarSrc(i)}" alt=""></div>
        <div class="_ak8l">
          <div class="_ak8o">
            <div class="_ak8q"><span dir="auto" title="${name}" class="x1iyjqo2 _ao3e">${name}</span></div>
            <div class="_ak8i">${time}</div>
          </div>
          <div class="_ak8j">
            <div class="_ak8k"><span title="${preview}" class="x78zum5"><span dir="ltr" class="_ao3e">${preview}</span></span></div>
            ${unread ? `<span class="badge" aria-label="${unread} unread messages">${unread}</span>` : ''}
          </div>
        </div>
      </div>`;
  }

  let photo = '';

  function mainPanel() {
    return `
        <div id="main">
          <header>
            <img src="https://pps.whatsapp.net/v/t61/p0.jpg" alt="">
            <div class="who"><span dir="auto" title="Alice Johnson">Alice Johnson</span><span title="online">online</span></div>
            <span data-icon="search">⌕</span>
          </header>
          <div role="application">
            <div role="row"><div class="message-in"><div class="copyable-text" data-pre-plain-text="[10:40, 19/10/2026] Alice Johnson: "><span class="selectable-text copyable-text"><span>Running late, see you at 11 <img class="emoji" data-plain-text="🙏" alt="🙏" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Ccircle cx='5' cy='5' r='5' fill='%23f5b400'/%3E%3C/svg%3E"></span></span></div></div></div>
            <div role="row"><div class="message-out"><div class="copyable-text" data-pre-plain-text="[10:41, 19/10/2026] You: "><span class="selectable-text copyable-text"><span>No problem, I'll order for you</span></span></div></div></div>
            <div role="row"><div class="message-in"><img class="photo" src="${photo}" alt=""></div></div>
          </div>
          <footer><div contenteditable="true" role="textbox" aria-label="Type a message">Draft: meeting moved to Friday</div></footer>
        </div>`;
  }

  function render() {
    document.getElementById('app').innerHTML = `
      <div class="two">
        <div id="side">
          <div class="search">Search or start a new chat</div>
          <div id="pane-side"><div role="grid" aria-label="Chat list">${chats.map(chatRow).join('')}</div></div>
        </div>
        ${mainPanel()}
      </div>`;
  }

  // A blob: photo, like a received image.
  const canvas = document.createElement('canvas');
  canvas.width = 220;
  canvas.height = 140;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3b7dd8';
  ctx.fillRect(0, 0, 220, 140);
  ctx.fillStyle = '#f2c14e';
  ctx.fillRect(30, 30, 80, 80);

  canvas.toBlob((blob) => {
    photo = URL.createObjectURL(blob);
    setTimeout(render, 150);
  });

  // Test hook: counts clicks that reach the app, like WhatsApp's own handlers would.
  window.__clicks = 0;
  document.addEventListener('click', () => window.__clicks++);

  // Test hook: open another chat in a freshly built panel, as a React remount would.
  window.__switchChat = () => {
    document.getElementById('main').outerHTML = mainPanel();
  };

  // Test hook: add a chat the way WhatsApp does when a new conversation arrives.
  window.__addChat = (name, preview) => {
    const grid = document.querySelector('#pane-side [role="grid"]');
    grid.insertAdjacentHTML('afterbegin', chatRow([name, preview, 'now', 1], 9));
  };
})();
