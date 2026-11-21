// What GitHub's browser upload ("Add files via upload") silently leaves out: any file or folder whose name starts
// with a dot. Used by make-upload.mjs and upload-rules.test.js.
export const droppedByBrowser = rel => rel.split(/[\\/]/).some(s => s.startsWith('.'));

// the only dot files the repo may have: they are left out of the upload on purpose (.gitattributes export-ignore)
export const ALLOWED_DOT_FILES = new Set(['.gitattributes', '.gitignore']);

// Never part of an upload, even if one were committed by mistake: installed packages (including the desktop shell's
// Electron in desktop/node_modules), per-machine data, test scratch folders, render output and anything inside .git
// (the phase checkpoints live in .git/studio-checkpoints).
export function excludedFromUpload(rel) {
  const segs = String(rel).split(/[\\/]/).filter(Boolean);
  if (!segs.length) return true;
  if (segs.includes('node_modules') || segs.includes('.git') || segs.includes('.test-tmp')) return true;
  if (segs[0] === 'data') return true;
  if (segs[0] === 'examples' && segs[2] === 'render') return true;
  return /\.tmp\.png$/i.test(segs.at(-1));
}

// Files an upload must contain: the desktop shell's sources and the documentation that describes the current app.
// make-upload.mjs stops when one is missing (for example, not committed yet).
export const REQUIRED_IN_UPLOAD = [
  'desktop/package.json', 'desktop/package-lock.json', 'desktop/main.js', 'desktop/hub-link.js', 'desktop/hub-link.test.js',
  'README.md', 'CLAUDE.md', 'AGENTS.md', 'docs/ARCHITECTURE.md', 'docs/MIGRATING.md', 'docs/AGENT-WAIT.md',
];
// pictures README.md shows (docs/screenshots/…): they must be in the upload too
export const readmeImages = text => [...String(text).matchAll(/\]\((docs\/screenshots\/[^)\s]+)\)/g)].map(m => m[1]);
export function missingFromUpload(files, readme = '') {
  const have = new Set(files);
  return [...new Set([...REQUIRED_IN_UPLOAD, ...readmeImages(readme)])].filter(f => !have.has(f));
}
