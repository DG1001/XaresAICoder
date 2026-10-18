const fs = require('fs').promises;
const path = require('path');

// One promise chain per file, so concurrent saves never interleave.
const writeQueues = new Map();

// Writes JSON atomically: the data is serialized at call time, written to a
// temp file and renamed over the target, so a crash or full disk can never
// leave a truncated file behind. Writes to the same file run in call order.
function writeJsonAtomic(file, data) {
  const content = JSON.stringify(data, null, 2);
  const run = async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    // 0600: these files hold password hashes and participant data
    await fs.writeFile(tmp, content, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tmp, file);
  };
  const previous = writeQueues.get(file) || Promise.resolve();
  const next = previous.catch(() => {}).then(run);
  writeQueues.set(file, next);
  next.finally(() => {
    if (writeQueues.get(file) === next) writeQueues.delete(file);
  }).catch(() => {});
  return next;
}

// Reads a JSON file. Returns null if it does not exist. A file that cannot be
// parsed is moved aside to <file>.corrupt-<timestamp> (so the next save cannot
// overwrite it) and null is returned.
async function readJson(file) {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    const quarantine = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await fs.rename(file, quarantine).catch(() => {});
    console.error(`Could not parse ${file} (${err.message}); moved it to ${quarantine}`);
    return null;
  }
}

module.exports = { writeJsonAtomic, readJson };
