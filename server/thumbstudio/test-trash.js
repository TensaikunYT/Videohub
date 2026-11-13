// Tests exercise reversible moves without opening the operating system's real Trash.
import fs from 'node:fs';
import path from 'node:path';

export function testTrash(prefix) {
  const parent = path.resolve(import.meta.dirname, '..', '..', '.test-tmp');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, prefix));
  const recycle = async items => items.map(({ path: source }) => {
    const relative = path.relative(root, path.resolve(source));
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Outside the test fixture');
    const dest = path.join(root, '.trash', relative);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(source, dest);
    return { path: source, ok: true, error: null };
  });
  return { root, recycle };
}
