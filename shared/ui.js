export function shouldSubmitComposerKey(event) {
  return event?.key === 'Enter' && !event.shiftKey && !event.isComposing;
}

export function isNearScrollEnd(element, threshold = 72) {
  if (!element) return true;
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

export function clampScrollTop(value, scrollHeight, clientHeight) {
  const maximum = Math.max(0, Number(scrollHeight || 0) - Number(clientHeight || 0));
  return Math.min(Math.max(0, Number(value || 0)), maximum);
}

export function composerHeight(scrollHeight, minimum = 48, maximum = 160) {
  return Math.min(Math.max(Number(scrollHeight || 0), minimum), maximum);
}

export function conversationScrollTarget({ forceBottom, stickToBottom, scrollTop, scrollHeight, clientHeight }) {
  const maximum = Math.max(0, Number(scrollHeight || 0) - Number(clientHeight || 0));
  if (forceBottom || stickToBottom) return maximum;
  return clampScrollTop(scrollTop, scrollHeight, clientHeight);
}

export function shouldRestoreDocumentScroll({ route, routeChanged, pendingPageScroll }) {
  return route !== 'terminal' && !routeChanged && !pendingPageScroll;
}

export function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (!bytes) return 'Tamaño no informado';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / (1024 ** index);
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}
