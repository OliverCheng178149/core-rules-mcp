import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = path.resolve("src/index.js");
const validAccess = { schema_version: 1, edition: "fixture", entries: {}, entry_count: 0 };

async function fixture(t, { rgScript, rgMode = 0o755, noRg = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "core-rules-errors-"));
  const client = new Client({ name: "core-rules-error-test", version: "1.0.0" });
  t.after(async () => {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, "lookups"));
  fs.mkdirSync(path.join(root, "bin"));
  const writeJson = (file, value) => fs.writeFileSync(path.join(root, file), JSON.stringify(value));
  writeJson("extraction_manifest.json", {
    books: [{ code: "fixture", short: "FIXTURE", title: "Error fixture", full_source_file: "_full_source_fixture.md", full_source_lines: 2 }]
  });
  writeJson("pdf_page_map.json", {});
  writeJson("lookup_catalog.json", []);
  writeJson("lookup_aliases.json", { known_variants: {} });
  writeJson("lookups/spell_access_catalog.json", validAccess);
  const bookPath = path.join(root, "_full_source_fixture.md");
  fs.writeFileSync(bookPath, "# Fixture\nUnique search marker\n");
  if (rgScript !== undefined) {
    fs.writeFileSync(path.join(root, "bin", "rg"), `#!${process.execPath}\n${rgScript}\n`, { mode: rgMode });
  }
  const env = { ...process.env, CORE_RULES_PATH: root };
  if (rgScript !== undefined || noRg) env.PATH = path.join(root, "bin");
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], env }));
  const call = (name, args) => client.callTool({ name, arguments: args }, undefined, { timeout: 10000 });
  return { client, root, bookPath, writeJson, call };
}

function responseText(result) {
  return result.content.map(part => part.text || "").join("\n");
}

for (const tool of ["search_core_rules", "lookup_rule_topic"]) {
  test(`${tool} reports an invalid regex and accepts a subsequent valid query`, async t => {
    const { call } = await fixture(t);
    const parameter = tool === "search_core_rules" ? "query" : "topic";
    const invalid = await call(tool, { [parameter]: "[", regex: true });
    assert.equal(invalid.isError, true);
    assert.match(responseText(invalid), /regex|regular expression/i);
    const valid = await call(tool, { [parameter]: "Unique search marker", regex: true });
    assert.notEqual(valid.isError, true);
    assert.match(responseText(valid), /Unique search marker/);
  });
}

test("search reports a missing registered book and recovers after it is restored", async t => {
  const { call, bookPath } = await fixture(t);
  fs.unlinkSync(bookPath);
  const missing = await call("search_core_rules", { query: "marker", books: "fixture" });
  assert.equal(missing.isError, true);
  assert.match(responseText(missing), /_full_source_fixture\.md/);
  assert.match(responseText(missing), /no such file|ENOENT/i);
  fs.writeFileSync(bookPath, "Restored search marker\n");
  const restored = await call("search_core_rules", { query: "marker", books: "fixture" });
  assert.notEqual(restored.isError, true);
  assert.match(responseText(restored), /Restored search marker/);
});

test("search keeps an ordinary no-match response successful", async t => {
  const { call } = await fixture(t);
  const result = await call("search_core_rules", { query: "No such fixture phrase" });
  assert.notEqual(result.isError, true);
  assert.match(responseText(result), /No local match/);
});

test("search rejects partial matches when rg exits with an error", async t => {
  const { call } = await fixture(t, { rgScript: `
process.stdout.write(process.argv.at(-1) + ":2:Unique search marker\\n");
process.stderr.write("fixture read failure\\n");
process.exitCode = 2;
` });
  const result = await call("search_core_rules", { query: "marker" });
  assert.equal(result.isError, true);
  assert.match(responseText(result), /rg.*2|2.*rg/i);
  assert.match(responseText(result), /fixture read failure/);
  assert.doesNotMatch(responseText(result), /^### /m);
});

test("search reports an rg execution error rather than a miss", async t => {
  const { call } = await fixture(t, { rgScript: "process.exitCode = 0;", rgMode: 0o644 });
  const result = await call("search_core_rules", { query: "marker" });
  assert.equal(result.isError, true);
  assert.match(responseText(result), /rg/i);
  assert.match(responseText(result), /EACCES|permission denied/i);
});

test("search rejects partial output when rg exceeds its output buffer", async t => {
  const { call } = await fixture(t, { rgScript: `
const fs = require("node:fs");
fs.writeSync(1, process.argv.at(-1) + ":2:Unique search marker\\n");
const block = "x".repeat(65536);
for (let index = 0; index < 160; index++) fs.writeSync(1, block);
` });
  const result = await call("search_core_rules", { query: "marker" });
  assert.equal(result.isError, true);
  assert.match(responseText(result), /ENOBUFS|buffer/i);
  assert.doesNotMatch(responseText(result), /^### /m);
});

test("search still uses the JS fallback when rg is unavailable", async t => {
  const { call } = await fixture(t, { noRg: true });
  const result = await call("search_core_rules", { query: "Unique search marker" });
  assert.notEqual(result.isError, true);
  assert.match(responseText(result), /Unique search marker/);
});

for (const value of [null, false, 0, "", { ...validAccess, entries: [] }]) {
  test(`required spell-access catalog rejects ${JSON.stringify(value)} and recovers`, async t => {
    const { call, writeJson } = await fixture(t);
    writeJson("lookups/spell_access_catalog.json", value);
    const invalid = await call("list_core_books", {});
    assert.equal(invalid.isError, true);
    assert.match(responseText(invalid), /spell-access catalog.*schema/i);
    writeJson("lookups/spell_access_catalog.json", validAccess);
    const restored = await call("list_core_books", {});
    assert.notEqual(restored.isError, true);
    assert.match(responseText(restored), /FIXTURE/);
  });
}

test("numeric parameter descriptions retain limits for hosts that omit numeric schema constraints", async t => {
  const { client } = await fixture(t);
  const listed = await client.listTools();
  for (const tool of listed.tools) {
    for (const [name, property] of Object.entries(tool.inputSchema.properties)) {
      if (!["integer", "number"].includes(property.type)) continue;
      const description = property.description || "";
      assert.match(description, /integer/i, `${tool.name}.${name}`);
      for (const field of ["minimum", "maximum", "default"]) {
        if (property[field] === undefined) continue;
        assert.match(description, new RegExp(`${field} ${property[field]}\\b`, "i"), `${tool.name}.${name} ${field}`);
      }
    }
  }
});

for (const directory of [false, true]) {
  test(`open rejects an unregistered ${directory ? 'directory' : 'file'} symlink outside the root`, async t => {
    const { root, call } = await fixture(t);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'core-outside-'));
    t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
    fs.writeFileSync(path.join(outside, 'outside.md'), 'OutsideBoundarySentinel\n');
    fs.symlinkSync(directory ? outside : path.join(outside, 'outside.md'), path.join(root, 'alias'));
    const rejected = await call('open_core_rules', { file: directory ? 'alias/outside.md' : 'alias', line: 1, reading_order: 'source' });
    assert.equal(rejected.isError, true);
    assert.doesNotMatch(responseText(rejected), /OutsideBoundarySentinel/);
  });
}

test('registered source symlinks remain usable without authorizing other outside aliases', async t => {
  const { root, bookPath, call } = await fixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'core-registered-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const source = path.join(outside, 'source.md');
  fs.writeFileSync(source, 'RegisteredSourceSentinel\n');
  fs.unlinkSync(bookPath);
  fs.symlinkSync(source, bookPath);
  fs.symlinkSync(source, path.join(root, 'other-alias.md'));
  const allowed = await call('open_core_rules', { file: '_full_source_fixture.md', line: 1, reading_order: 'source' });
  assert.notEqual(allowed.isError, true);
  assert.match(responseText(allowed), /RegisteredSourceSentinel/);
  const denied = await call('open_core_rules', { file: 'other-alias.md', line: 1, reading_order: 'source' });
  assert.equal(denied.isError, true);
});

test('ordinary in-root aliases and registered sibling basename lookup remain usable', async t => {
  const { root, bookPath, call } = await fixture(t);
  fs.symlinkSync(bookPath, path.join(root, 'inside.md'));
  // A unique parent avoids sharing the server's fixed optional sibling location.
  // The fixture itself is moved beneath a new private parent before connecting a second client.
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'core-sibling-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const nested = path.join(parent, 'rules');
  fs.cpSync(root, nested, { recursive: true, dereference: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(nested, 'extraction_manifest.json'), 'utf8'));
  manifest.books[0].code = 'phb14';
  fs.writeFileSync(path.join(nested, 'lookups/spell_access_catalog.json'), JSON.stringify({ ...validAccess, edition: '2014' }));
  fs.writeFileSync(path.join(nested, 'extraction_manifest.json'), JSON.stringify(manifest));
  fs.mkdirSync(path.join(parent, 'user_provided_statblocks'));
  fs.writeFileSync(path.join(parent, 'user_provided_statblocks/user_statblocks_full.md'), 'SiblingSourceSentinel\n');
  const client = new Client({ name: 'core-sibling-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], env: { ...process.env, CORE_RULES_PATH: nested } }));
  t.after(() => client.close());
  const inside = await call('open_core_rules', { file: 'inside.md', line: 1, reading_order: 'source' });
  assert.notEqual(inside.isError, true);
  for (const file of ['user_statblocks_full.md', '../user_provided_statblocks/user_statblocks_full.md']) {
    const result = await client.callTool({ name: 'open_core_rules', arguments: { file, line: 1, reading_order: 'source' } });
    assert.notEqual(result.isError, true);
    assert.match(responseText(result), /SiblingSourceSentinel/);
  }
});

test('a symlinked library root preserves legitimate in-root aliases', async t => {
  const { root, bookPath } = await fixture(t);
  fs.symlinkSync(bookPath, path.join(root, 'inside.md'));
  const alias = `${root}-alias`;
  fs.symlinkSync(root, alias);
  t.after(() => fs.unlinkSync(alias));
  const client = new Client({ name: 'core-root-alias-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], env: { ...process.env, CORE_RULES_PATH: alias } }));
  t.after(() => client.close());
  const result = await client.callTool({ name: 'open_core_rules', arguments: { file: 'inside.md', line: 1, reading_order: 'source' } });
  assert.notEqual(result.isError, true);
  assert.match(responseText(result), /Unique search marker/);
});

for (const noRg of [false, true]) {
  for (const directory of [false, true]) {
    test(`search rejects unregistered outside lookup ${directory ? 'directory' : 'file'} links (${noRg ? 'JS fallback' : 'rg'})`, async t => {
      const { root, call } = await fixture(t, { noRg });
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'core-search-outside-'));
      t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
      fs.writeFileSync(path.join(outside, 'alias.md'), 'OutsideSearchSentinel\n');
      if (directory) {
        fs.cpSync(path.join(root, 'lookups'), outside, { recursive: true });
        fs.rmSync(path.join(root, 'lookups'), { recursive: true });
        fs.symlinkSync(outside, path.join(root, 'lookups'));
      } else fs.symlinkSync(path.join(outside, 'alias.md'), path.join(root, 'lookups/alias.md'));
      const denied = await call('search_core_rules', { query: 'OutsideSearchSentinel' });
      assert.equal(denied.isError, true);
      assert.doesNotMatch(responseText(denied), /OutsideSearchSentinel/);
    });
  }
}
