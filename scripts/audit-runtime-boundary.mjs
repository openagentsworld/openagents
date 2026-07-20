import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const ignoredDirectories = new Set(['.git', 'dist', 'node_modules']);
const runtimeRoots = ['blocks', 'data'];
const runtimeFiles = ['index.html', 'main.js', 'style.css'];
const failures = [];
const repositoryFiles = [];
const allowedTopLevel = new Set([
  '.gitignore',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'SECURITY.md',
  'TRADEMARKS.md',
  'blocks',
  'data',
  'index.html',
  'main.js',
  'package-lock.json',
  'package.json',
  'scripts',
  'style.css',
]);

const forbiddenRuntimePatterns = [
  [/https?:\/\//i, 'external URL'],
  [/\bfetch\s*\(/i, 'fetch call'],
  [/\bWebSocket\s*\(/i, 'WebSocket call'],
  [/\bXMLHttpRequest\b/i, 'XMLHttpRequest'],
  [/\bEventSource\s*\(/i, 'EventSource call'],
  [/\bsendBeacon\s*\(/i, 'sendBeacon call'],
  [/\/(?:api|webhooks?)\//i, 'API or webhook path'],
  [/\b(?:payment|payout|admin)\b/i, 'production-only term'],
  [/(?:\.(?:env|runtime)|BEGIN [A-Z ]*PRIVATE KEY)/i, 'private runtime or key marker'],
];

const credentialPatterns = [
  [/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/, 'GitHub credential'],
  [/(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{12,}/, 'provider credential'],
  [/sk-[A-Za-z0-9_-]{20,}/, 'API credential'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/[0-9]{6,}:[A-Za-z0-9_-]{20,}/, 'bot credential'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/(?:password|passwd|token|secret|api[_ -]?key)\s*[:=]\s*["']?[A-Za-z0-9_./+\-=]{16,}/i, 'assigned secret'],
];

const privateContextPatterns = [
  [/\b(?!127\.0\.0\.1\b)(?:\d{1,3}\.){3}\d{1,3}\b/, 'non-loopback IPv4 address'],
  [/\/home\/[^/\s]+/i, 'private Unix user path'],
  [/[A-Za-z]:\\Users\\[^\\\s]+/i, 'private Windows user path'],
  [/\b[A-Z][A-Z0-9_]*(?:ADMIN|WEBHOOK|BOT)[A-Z0-9_]*(?:TOKEN|SECRET|KEY)\b/, 'private environment key'],
  [/\bIBAN\b/i, 'banking marker'],
  [/(?:bank account|phone number)/i, 'personal-data marker'],
];

async function walk(relative = '.') {
  const absolute = path.join(root, relative);
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    if (relative === '.' && ignoredDirectories.has(entry.name)) continue;
    const child = path.join(relative, entry.name);
    const childAbsolute = path.join(root, child);
    const stat = await lstat(childAbsolute);
    if (stat.isSymbolicLink()) failures.push(`${child}: symbolic links are not allowed`);
    if (stat.isDirectory()) await walk(child);
    if (stat.isFile()) {
      repositoryFiles.push(child);
      const topLevel = child.split(path.sep)[0];
      if (!allowedTopLevel.has(topLevel)) failures.push(`${child}: unexpected top-level entry`);
      if (/^\.env(?:\.|$)/i.test(entry.name)) failures.push(`${child}: environment files are not allowed`);
    }
  }
}

async function collectFiles(relative) {
  const absolute = path.join(root, relative);
  const stat = await lstat(absolute);
  if (stat.isFile()) return [relative];
  const files = [];
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(child)));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

await walk();

const sourceFiles = [...runtimeFiles];
for (const directory of runtimeRoots) sourceFiles.push(...(await collectFiles(directory)));

for (const file of sourceFiles) {
  const content = await readFile(path.join(root, file), 'utf8');
  for (const [pattern, label] of forbiddenRuntimePatterns) {
    const scannable =
      label === 'external URL'
        ? content.replaceAll('http://www.w3.org/2000/svg', '')
        : content;
    if (pattern.test(scannable)) failures.push(`${file}: contains ${label}`);
  }
}

for (const file of repositoryFiles) {
  if (file === path.join('scripts', 'audit-runtime-boundary.mjs')) continue;
  const content = await readFile(path.join(root, file), 'utf8');
  for (const [pattern, label] of credentialPatterns) {
    if (pattern.test(content)) failures.push(`${file}: contains ${label}`);
  }
  for (const [pattern, label] of privateContextPatterns) {
    if (pattern.test(content)) failures.push(`${file}: contains ${label}`);
  }
}

if (failures.length) {
  console.error('Public-demo boundary audit failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(
  `Public-demo boundary audit passed (${sourceFiles.length} runtime files, ${repositoryFiles.length} repository files, no symlinks).`,
);
