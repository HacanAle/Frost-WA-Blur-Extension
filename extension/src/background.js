// Service worker: keyboard shortcuts and the toolbar badge. Nothing else.
// It has no network code and no message handlers.

importScripts('shared/settings.js');

const { load, save } = self.Frost;

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({ settings: await load(), hidden: false });
  await updateBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.storage.local.set({ hidden: false });
  await updateBadge();
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-blur') {
    const settings = await load();
    await save({ enabled: !settings.enabled });
  } else if (command === 'hide-window') {
    const { hidden } = await chrome.storage.local.get('hidden');
    await chrome.storage.local.set({ hidden: !hidden });
  }
});

async function updateBadge() {
  const settings = await load();
  await chrome.action.setBadgeBackgroundColor({ color: '#6a6457' });
  await chrome.action.setBadgeText({ text: settings.enabled ? '' : 'off' });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const before = changes.settings.oldValue || {};
  const after = changes.settings.newValue || {};
  if (before.enabled !== after.enabled) updateBadge();
});
