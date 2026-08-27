// Prettier does not see a UTF-8 BOM, and a BOM has already broken this repo once:
// it made package.json invalid JSON. Editors on Windows add one silently, so the
// check has to run in CI rather than rely on .editorconfig being honoured.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const withBom = files.filter(file => {
  let handle;
  try {
    handle = fs.openSync(file, 'r');
  } catch {
    return false; // deleted or unreadable in this checkout
  }
  const head = Buffer.alloc(3);
  fs.readSync(handle, head, 0, 3, 0);
  fs.closeSync(handle);
  return head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf;
});

if (withBom.length > 0) {
  console.error('UTF-8 BOM found. Save these files as UTF-8 without BOM:');
  for (const file of withBom) console.error(`  ${file}`);
  process.exit(1);
}
console.log(`No BOM in ${files.length} tracked files.`);
