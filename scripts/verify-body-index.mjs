#!/usr/bin/env node
// End-to-end, offline check of a generated spell or item body index against
// the library's own source files: every indexed entry is looked up through the
// MCP server, and each source slice must appear exactly once, in order, with
// no foreign entry heading, fallback warning or truncation.
// Usage: node scripts/verify-body-index.mjs /path/to/library [--kind spell|item]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const args = process.argv.slice(2);
const kindAt = args.indexOf('--kind');
const kind = kindAt === -1 ? 'spell' : args.splice(kindAt, 2)[1];
const [library] = args;
if (!library || !['spell', 'item'].includes(kind)) {
  throw new Error('Usage: node scripts/verify-body-index.mjs /path/to/library [--kind spell|item]');
}
const root = path.resolve(library);
const tool = kind === 'spell' ? 'lookup_spell' : 'lookup_item';
const server = fileURLToPath(new URL('../src/index.js', import.meta.url));
const index = JSON.parse(fs.readFileSync(path.join(root, 'lookups', `${kind}_body_index.json`), 'utf8'));
assert.equal(index.entry_count, index.entries.length, 'entry_count differs from entries');

const sources = new Map(Object.entries(index.sources)
  .map(([book, source]) => [book, fs.readFileSync(path.join(root, source.file), 'utf8').split(/\r?\n/)]));
const headingOwners = new Map(index.entries.flatMap(e => e.fragments.flatMap(f => f.slices
  .filter(s => s[0] === e.heading.line)
  .map(s => [`${e.book}:${s[0]}:${s[1]}:${s[2]}`, e.name]))));

const client = new Client({name: 'body-index-verification', version: '1.0'});
await client.connect(new StdioClientTransport({
  command: process.execPath, args: [server], env: {...process.env, CORE_RULES_PATH: root}
}));
try {
  for (const e of index.entries) {
    const response = await client.callTool({
      name: tool, arguments: {name: e.name, books: e.book, max_results: 1, context_lines: 0}
    });
    const out = response.content.map(c => c.text || '').join('\n');
    assert.notEqual(response.isError, true, e.name);
    assert.match(out, new RegExp(`reading_order: indexed ${kind} fragments`), e.name);
    assert.doesNotMatch(out, /WARNING:|\[truncated:|### SRD/, e.name);
    let cursor = 0;
    for (const f of e.fragments) {
      for (const [line, start, end] of f.slices) {
        const owner = headingOwners.get(`${e.book}:${line}:${start}:${end}`);
        assert.ok(!owner || owner === e.name, `${e.name} includes foreign heading ${owner}`);
        let source = Array.from(sources.get(e.book)[line - 1]).slice(start, end).join('');
        const repair = e.repairs?.find(r => r.line === line && r.column === f.column);
        if (repair) {
          assert.equal(source, repair.before, `${e.name}: stale repair`);
          assert.ok(repair.evidence?.trim(), `${e.name}: repair without evidence`);
          source = repair.after;
        }
        const row = `${line}${f.column} | ${source}`;
        const pos = out.indexOf(row, cursor);
        assert.ok(pos >= cursor, `${e.book} ${e.name}: source slice ${line}${f.column} missing or out of order`);
        assert.equal(out.indexOf(row, pos + row.length), -1, `${e.name}: duplicate source slice`);
        cursor = pos + row.length;
      }
    }
  }
} finally {
  await client.close();
}
console.log(`PASS ${index.entries.length} indexed ${kind} bodies: all slices in order, no foreign headings, fallbacks or truncation.`);
