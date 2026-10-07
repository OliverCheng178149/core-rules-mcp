# core-rules-mcp

Local read-only MCP server for page-anchored lookups in a fifth-edition rules
library that you provide: spells, monsters, items, rule topics, curated rule
tables, and structured spell-access records.

Released under the [MIT License](LICENSE). No rulebooks, extracted book text,
or catalogs derived from published books are bundled. Bring your own library
built from material you are entitled to use. `examples/synthetic-rules-library`
is original invented content for tests and demos.

It is the rules companion to
[campaign-source-mcp](https://github.com/OliverCheng178149/campaign-source-mcp),
which routes module and setting cards.

## Install independently

Requires Node.js >=18 and npm. `rg` (ripgrep) is optional; the server has a
JavaScript search fallback.

```sh
git clone https://github.com/OliverCheng178149/core-rules-mcp.git
cd core-rules-mcp
npm ci
npm test
npm run demo
```

`npm test` runs only self-contained synthetic tests: path-boundary and error
handling, two-column OCR reading order, and an eight-tool stdio demo against
`examples/synthetic-rules-library`. `npm run demo` runs the demo alone.

## Configure an MCP host

Adapt this example in your host's MCP settings. Absolute paths are required;
replace the placeholders. The host must be able to find `node`, or use the
absolute path to your Node executable.

```json
{
  "mcpServers": {
    "core-rules": {
      "command": "node",
      "args": ["/absolute/path/core-rules-mcp/src/index.js"],
      "env": {
        "CORE_RULES_PATH": "/absolute/path/your-rules-library",
        "CORE_RULES_LABEL": "My rules library"
      }
    }
  }
}
```

`CORE_RULES_PATH` must contain `extraction_manifest.json`; there is no default
location. To keep two rule editions apart, configure two server entries that
point at two libraries. Starting the server waits for MCP stdio input; it is
not a human-facing CLI. For an isolated demo, use the absolute path to
`examples/synthetic-rules-library`.

## Library format

A library is a directory of page-anchored Markdown caches plus small JSON
indexes. See [docs/library-format.md](docs/library-format.md) for every file
and field. In short:

- `extraction_manifest.json` registers each book (`code`, `short`, `title`,
  `full_source_file`, `full_source_lines`).
- `_full_source_<code>.md` holds each book's text with `## PDF Page N`
  headings.
- `pdf_page_map.json`, `lookup_catalog.json`, `lookup_aliases.json`, and
  `lookups/spell_access_catalog.json` are required; an empty but valid file is
  acceptable for each.
- `lookups/structured_rule_tables.json` and `lookups/*.md` routing cards are
  optional.

For one way to extract page-anchored text from material you own, see
campaign-source-mcp's
[source library guide](https://github.com/OliverCheng178149/campaign-source-mcp/blob/main/docs/building-a-source-library.md).

## Tools

- `list_core_books`: installed books and cache files.
- `search_core_rules`: literal or regex search, or `match=all_terms` for a
  multi-keyword topic query anchored on a catalog entry or heading.
- `open_core_rules`: a small line-numbered window from a library file.
- `lookup_spell`: a spell body by name. It does not establish who can cast it.
- `lookup_spell_access`: class, subclass, feature, and feat access paths from
  the structured catalog only.
- `lookup_monster`, `lookup_item`: stat-block and item bodies by name.
- `lookup_rule_topic`: rule headings, curated tables, and routing cards.

All tools cap returned context and include file, line, and PDF page pointers.
Use them as on-demand lookups, not as a startup bulk read.

## Reading order

Full-source caches can keep two physical text columns on the same OCR row.
Search context, structured bodies, rule lookups, and `open_core_rules` use
`reading_order=auto` by default: confident `## PDF Page` blocks are shown in
logical reading order while every original line number is kept with an `L` or
`R` marker. Reconstruction applies only to registered book files named
`_full_source*.md`; lookup cards and other files keep their source order.
Low-confidence pages fall back to physical source order and say so. Use
`open_core_rules(..., reading_order="source")` to inspect the exact original
rows. Source files and pointers are never rewritten.

## Lookup discipline

- `lookup_spell` proves only that a spell body exists. For any class, subclass,
  or feature access question, call `lookup_spell_access`. It never infers
  access from OCR text.
- `audited` access records carry verified acquisition semantics.
  `discovery-only` records are locators: read the named feature before claiming
  a spell is known, prepared, or always available.
- `Base-list verdict: NO` can coexist with a conditional path such as a
  subclass feature. An unknown class filter produces no verdict.
- `lookup_monster`, `lookup_item`, and `lookup_spell` check that a hit has the
  shape of a body entry; lists, indexes, and incidental mentions are ignored.
- Search errors, invalid regexes, and unreadable files return tool errors. A
  completed search with no hits returns a normal no-match response.

## Built-in book codes

The server recognizes some book codes from its author's own library layout,
for example `phb14`, `phb24`, `dmg14`, `mm14`, `xge`, and `tce`. Using them
changes behaviour: type-specific default search sets, edition checks
(`phb14` requires catalog edition `2014`, `phb24` requires `2024`), local SRD
fallbacks from fixed sibling directories such as `../_srd_5e`, and optional
sibling caches that a `phb14` or `phb24` library registers when specific
`../official_*` or `../user_provided_statblocks` files exist. Nothing happens
when those files are absent.

For a new library, prefer your own lowercase codes (the demo uses `syn`); then
every lookup searches all registered books and no sibling paths are read.

## Tests

`npm test` and `npm run demo` use synthetic data only. Integration tests that
run against real rulebooks are not part of this repository. `npm run selftest`
is a legacy diagnostic for the author's private library and asserts records a
different library will not have; use `npm run demo` for a book-free smoke test.

Read [SECURITY.md](SECURITY.md) before choosing a library root.
