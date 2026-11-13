// Server capabilities provide platform wording without importing Node code into the UI.
let current = {};
export function setSystemCapabilities(value) { current = value && typeof value === 'object' ? value : {}; }
export const trashName = () => current.trashLabel || 'Trash / Recycle Bin';
export function sameFolder(a, b) {
  // Preserve case and literal backslashes on Unix; Windows treats slashes and case alike.
  const key = value => {
    const s = String(value || '').trim();
    return current.platform === 'win32' ? s.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : s.replace(/\/+$/, '') || (s.startsWith('/') ? '/' : '');
  };
  return key(a) === key(b);
}
