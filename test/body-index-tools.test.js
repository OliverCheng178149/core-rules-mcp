import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import test from 'node:test';

// A synthetic two-column page: the spell starts in the left column and
// continues at the top of the right column, above an unrelated entry.
const row = (left, right = '') => (right ? left.padEnd(35) + right : left);
const rows = [
  '## PDF Page 1',
  row('Previous entry tail.', 'Fixture continuation ends here.'),
  row('FIXTURE SPELL', 'OTHER FIXTURE'),
  row('Casting Time: Action', 'Unrelated neighbor text.'),
  row('Fixture beginning in the left.')
];

function library(t, kind) {
  const sourcesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'body-index-tools-'));
  t.after(() => fs.rmSync(sourcesRoot, {recursive: true, force: true}));
  const root = path.join(sourcesRoot, 'lib');
  fs.mkdirSync(path.join(root, 'lookups'), {recursive: true});
  const file = '_full_source_fixture.md';
  fs.writeFileSync(path.join(root, file), rows.join('\n'));
  const json = (p, x) => fs.writeFileSync(path.join(root, p), JSON.stringify(x));
  json('extraction_manifest.json', {books: [{code: 'fixture', short: 'FIXTURE', full_source_file: file}]});
  json('pdf_page_map.json', {}); json('lookup_catalog.json', []); json('lookup_aliases.json', {known_variants: {}});
  json('lookups/spell_access_catalog.json', {schema_version: 1, edition: 'fixture', entry_count: 0, entries: {}});
  const layout = {
    schema_version: 1, kind, reviewed_on: 'test',
    books: {fixture: {
      folder: 'lib', file,
      sha256: createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'),
      pages: {'1': 35},
      headings: [
        {name: 'Fixture Spell', line: 3, column: 'L', pdf_page: 1},
        {name: 'Other Fixture', line: 3, column: 'R', pdf_page: 1}
      ],
      exclude: [],
      attachments: []
    }}
  };
  const layoutPath = path.join(sourcesRoot, 'layout.json');
  fs.writeFileSync(layoutPath, JSON.stringify(layout));
  const build = (...extra) => execFileSync('python3', ['-B', 'scripts/build-spell-body-index.py',
    '--sources-root', sourcesRoot, '--layout', layoutPath, '--kind', kind, ...extra], {encoding: 'utf8'});
  const verify = () => execFileSync(process.execPath, ['scripts/verify-body-index.mjs', root, '--kind', kind], {encoding: 'utf8'});
  return {root, build, verify};
}

for (const kind of ['spell', 'item']) {
  test(`${kind}: builder output passes --check and the end-to-end verifier`, t => {
    const {root, build, verify} = library(t, kind);
    assert.match(build(), /WROTE .* 2 entries/);
    assert.match(build('--check'), /PASS/);
    assert.match(verify(), new RegExp(`PASS 2 indexed ${kind} bodies`));
    const index = JSON.parse(fs.readFileSync(path.join(root, 'lookups', `${kind}_body_index.json`), 'utf8'));
    const own = index.entries.find(e => e.name === 'Fixture Spell');
    assert.deepEqual(own.fragments.map(f => [f.column, f.slices.map(s => s[0])]), [['L', [3, 4, 5]], ['R', [2]]]);
  });
}

test('the builder refuses a layout of the other kind', t => {
  const {build} = library(t, 'item');
  assert.throws(() => build('--kind', 'spell'), /does not match --kind/);
});

test('the verifier fails when the source changed after the index was built', t => {
  const {root, build, verify} = library(t, 'spell');
  build();
  fs.appendFileSync(path.join(root, '_full_source_fixture.md'), '\nchanged');
  assert.throws(verify, /indexed spell fragments|WARNING/);
});
