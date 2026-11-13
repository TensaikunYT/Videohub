// Local source diagnostics, not an antivirus scan. No network, process execution, settings changes or file writes.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = ['package.json', 'SETUP.cmd', 'UPDATE.cmd', 'UNINSTALL.cmd', 'open.cmd', 'setup.ps1', 'update.ps1', 'uninstall.ps1',
  'scripts/install.mjs', 'server/platform.js', 'server/util.js', 'server/guard.js'];
const sha256 = data => createHash('sha256').update(data).digest('hex');

export function inspectWindowsSecurity(root = ROOT, { filesystem: io = fs } = {}) {
  const base = io.realpathSync(root);
  const contained = full => { const rel = path.relative(base, io.realpathSync(full)); return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };
  const files = SOURCE.map(file => {
    try {
      const full = path.join(root, file);
      if (io.lstatSync(full).isSymbolicLink()) return { file, status: 'symbolic-link' };
      if (!contained(full)) return { file, status: 'outside-install' };
      const data = io.readFileSync(full);
      return { file, status: 'present', sha256: sha256(data), policyOverride: /-ExecutionPolicy\s+(?:Bypass|Unrestricted)|-EncodedCommand\b/i.test(data.toString('utf8')) };
    } catch (e) { return { file, status: e.code === 'ENOENT' ? 'missing' : 'unreadable' }; }
  });
  const legacy = ['open.vbs', 'open.ps1'];
  const guard = path.join(root, 'guard');
  try {
    if (!io.lstatSync(guard).isSymbolicLink() && contained(guard)) for (const file of io.readdirSync(guard)) {
      if (/^(?:VideoHubAgent|RenderGuard)(?:\.old)?\.exe$/i.test(file)) legacy.push('guard/' + file);
    }
  } catch { }
  const legacyFiles = legacy.filter(file => { try { return io.lstatSync(path.join(root, file)).isFile(); } catch { return false; } });
  return {
    schema: 1,
    sourceFingerprint: sha256(files.map(f => f.file + ':' + (f.sha256 || f.status)).join('\n')),
    nodeVersion: process.version,
    files,
    legacyFiles,
    interpretation: 'Source metadata only. A matching fingerprint identifies these source files; it does not establish safety or an antivirus verdict. Include the security product, exact alert, affected file and this fingerprint when reporting an issue. No report is sent automatically.'
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(a => a !== '--help')) { console.error('Usage: node scripts/windows-security.mjs [--help]'); process.exitCode = 1; }
  else if (process.argv.includes('--help')) console.log('Print local source fingerprints and retired Windows helper names. Reads this installation only; never uploads, executes helpers, changes security settings or writes files. This is not an antivirus scan.');
  else console.log(JSON.stringify(inspectWindowsSecurity(), null, 2));
}
