import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';

const LOG_DIR       = process.env.LOG_DIR      || '/app/logs';
const LOG_MAX_BYTES = parseInt(process.env.LOG_MAX_MB    || '10', 10) * 1024 * 1024;
const LOG_MAX_FILES = parseInt(process.env.LOG_MAX_FILES || '5', 10);
const LOG_FILE      = join(LOG_DIR, 'app.log');

let _stream = null;
let _bytes  = 0;

function ensureStream() {
  if (_stream) return _stream;
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    _stream = createWriteStream(LOG_FILE, { flags: 'a' });
    _bytes  = existsSync(LOG_FILE) ? statSync(LOG_FILE).size : 0;
  } catch {
    // No-op stream so console capture never crashes the server / tests
    _stream = { write() {}, end() {} };
  }
  return _stream;
}

function rotate() {
  if (_stream) _stream.end();
  try {
    for (let i = LOG_MAX_FILES - 1; i >= 1; i--) {
      const src = `${LOG_FILE}.${i}`;
      if (existsSync(src)) renameSync(src, `${LOG_FILE}.${i + 1}`);
    }
    if (existsSync(`${LOG_FILE}.${LOG_MAX_FILES + 1}`)) unlinkSync(`${LOG_FILE}.${LOG_MAX_FILES + 1}`);
    renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch { /* best-effort */ }
  _stream = null;
  _bytes  = 0;
  ensureStream();
}

['log', 'info', 'warn', 'error'].forEach(level => {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    orig(...args);
    const line = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    const entry = `${new Date().toISOString()} [${level.toUpperCase()}] ${line}\n`;
    const stream = ensureStream();
    if (_bytes + entry.length > LOG_MAX_BYTES) rotate();
    stream.write(entry);
    _bytes += entry.length;
  };
});
