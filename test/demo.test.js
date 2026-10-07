import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Exercises all eight tools against the original synthetic library in
// examples/synthetic-rules-library. No published rules text is involved.
const root = path.resolve("examples/synthetic-rules-library");
const book = "_full_source_synthetic.md";

async function connect(t) {
  const client = new Client({ name: "core-rules-demo", version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("src/index.js")],
    env: { ...process.env, CORE_RULES_PATH: root, CORE_RULES_LABEL: "" }
  }));
  t.after(() => client.close());
  return async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 10000 });
    return { isError: result.isError === true, text: result.content.map(part => part.text || "").join("\n") };
  };
}

test("list_core_books describes the synthetic library", async t => {
  const call = await connect(t);
  const { isError, text } = await call("list_core_books");
  assert.equal(isError, false);
  assert.match(text, /Rules library: Synthetic Clockwork Rules \(demo\)/);
  assert.match(text, /- SYN \(syn\) — Synthetic Clockwork Rules; file _full_source_synthetic\.md; 62 lines/);
});

test("search_core_rules finds literal text, routing cards, and multi-term topics", async t => {
  const call = await connect(t);

  const column = await call("search_core_rules", { query: "Skipped oilings", books: "syn", context_lines: 2 });
  assert.equal(column.isError, false);
  assert.match(column.text, /### SYN _full_source_synthetic\.md:55, pdf p\.5/);
  assert.match(column.text, /reading_order: reconstructed/);
  assert.match(column.text, /55R \| Skipped oilings add one step of gear fatigue\./);
  assert.doesNotMatch(column.text, /55L/);

  const routing = await call("search_core_rules", { query: "Synthetic Routing Card", type: "rule" });
  assert.match(routing.text, /### file lookups\/synthetic_routing\.md:1/);

  const topic = await call("search_core_rules", { query: "gear fatigue winding", match: "all_terms" });
  assert.match(topic.text, /### SYN _full_source_synthetic\.md:5, pdf p\.1/);

  const missing = await call("search_core_rules", { query: "Gear", books: "phb14" });
  assert.equal(missing.isError, true);
  assert.match(missing.text, /not installed in this rules library: phb14\. Installed: syn/);
});

test("open_core_rules reconstructs columns and can show physical rows", async t => {
  const call = await connect(t);

  const auto = await call("open_core_rules", { file: book, line: 58, context_lines: 3 });
  assert.match(auto.text, /### _full_source_synthetic\.md:58, pdf p\.5/);
  assert.match(auto.text, /reading_order: reconstructed/);
  assert.match(auto.text, /59L \| without harming the device that holds it\.\n53R \| OILING SCHEDULE/);

  const source = await call("open_core_rules", { file: book, line: 58, context_lines: 3, reading_order: "source" });
  assert.doesNotMatch(source.text, /reading_order:/);
  assert.match(source.text, /55 \| Tension rises.*Skipped oilings/);

  const shared = await call("open_core_rules", { file: book, line: 55, context_lines: 1 });
  assert.match(shared.text, /source-order fallback \(PDF page 5\)/);
});

test("lookup_spell returns a spell body but defers access questions", async t => {
  const call = await connect(t);
  const { isError, text } = await call("lookup_spell", { name: "Lantern Spark", books: "syn", max_results: 1 });
  assert.equal(isError, false);
  assert.match(text, /lookup_spell_access/);
  assert.match(text, /### SYN _full_source_synthetic\.md:20, pdf p\.2/);
  assert.match(text, /Casting Time: 1 action/);
});

test("lookup_spell_access reports structured access paths only", async t => {
  const call = await connect(t);

  const all = await call("lookup_spell_access", { name: "Lantern Spark" });
  assert.match(all.text, /Edition: synthetic/);
  assert.match(all.text, /Catalog provenance: synthetic example catalog @ synthetic-fixture-1/);
  assert.match(all.text, /- Wizard \(SYN\)/);
  assert.match(all.text, /- Tinker \(SYN; enabled by SYN Optional Rules\)/);
  assert.match(all.text, /\*\*Cog Knight Sparkcraft\*\* \[audited; subclass; always prepared; Fighter level 3\]/);
  assert.match(all.text, /\*\*Spark Adept\*\* \[discovery-only; feat; choice; Lantern Spark\]/);

  const wizard = await call("lookup_spell_access", { name: "Lantern Spark", class_name: "Wizard" });
  assert.match(wizard.text, /Base-list verdict: YES/);

  const fighter = await call("lookup_spell_access", { name: "Lantern Spark", class_name: "fighters" });
  assert.match(fighter.text, /Base-list verdict: NO/);
  assert.match(fighter.text, /Cog Knight Sparkcraft/);

  const alias = await call("lookup_spell_access", { name: "Amber Mote", class_name: "tinker" });
  assert.match(alias.text, /- Tinker \[optional class list; enabled by SYN Optional Rules\]/);

  const unknown = await call("lookup_spell_access", { name: "Lantern Spark", class_name: "banana" });
  assert.match(unknown.text, /Unknown class filter "banana"/);
  assert.doesNotMatch(unknown.text, /Base-list verdict/);
});

test("lookup_monster and lookup_item return body windows, including aliases", async t => {
  const call = await connect(t);

  for (const name of ["Brass Warden", "Brass Sentry"]) {
    const monster = await call("lookup_monster", { name, books: "syn", max_results: 1 });
    assert.match(monster.text, /### SYN _full_source_synthetic\.md:40, pdf p\.4/, name);
    assert.match(monster.text, /Armor Class 16/, name);
    assert.match(monster.text, /Piston Fist/, name);
    assert.doesNotMatch(monster.text, /SPRING TENSION/, name);
  }

  for (const name of ["Clockwork Compass", "Gear Compass"]) {
    const item = await call("lookup_item", { name });
    assert.match(item.text, /### SYN _full_source_synthetic\.md:32, pdf p\.3/, name);
    assert.match(item.text, /\*Wondrous item, uncommon\*/, name);
  }
});

test("lookup_rule_topic uses headings, curated tables, columns, and routing cards", async t => {
  const call = await connect(t);

  for (const topic of ["Gear Fatigue", "Cog Wear"]) {
    const rule = await call("lookup_rule_topic", { topic });
    assert.match(rule.text, /### SYN _full_source_synthetic\.md:5, pdf p\.1/, topic);
  }

  const table = await call("lookup_rule_topic", { topic: "gear upkeep prices", books: "syn" });
  assert.match(table.text, /reading_order: curated structured table/);
  assert.match(table.text, /\| Brass winding key \| 2 sp \|/);

  const left = await call("lookup_rule_topic", { topic: "Spring Tension", books: "syn", max_results: 1 });
  assert.match(left.text, /reading_order: reconstructed/);
  assert.match(left.text, /59L \| without harming/);
  assert.doesNotMatch(left.text, /OILING/);

  const right = await call("lookup_rule_topic", { topic: "Oiling Schedule" });
  assert.match(right.text, /62R \| so the next keeper knows where to begin\./);
  assert.doesNotMatch(right.text, /SPRING TENSION/);

  const routed = await call("lookup_rule_topic", { topic: "clockwork upkeep" });
  assert.match(routed.text, /### file lookups\/synthetic_routing\.md:2/);
});
