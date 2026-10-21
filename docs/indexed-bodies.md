# Indexed complete bodies

A legacy lookup returns a capped window around a heading. On a two-column OCR
page that window can stop mid-entry, miss a continuation at the top of the
next column or page, or pick up a neighbouring entry. An optional *body index*
fixes this for a library you have reviewed: it records exactly which source
characters belong to each spell, item or monster, and the lookup returns all
of them in reading order, regardless of `context_lines` or output caps.

Everything here is optional. A library without index files behaves exactly
as before.

Index files, layouts and monster reading projections are built from your own
books and contain their text or exact coordinates into it. Keep them in your
private library, never in a public repository or bug report. This repository
ships the code and invented test fixtures only.

## What the server reads

| File | Used by |
| --- | --- |
| `lookups/spell_body_index.json` | `lookup_spell` |
| `lookups/item_body_index.json` | `lookup_item` |
| `lookups/monster_body_index.json` | `lookup_monster` |
| `lookups/monster_bodies/<code>.md` | generated monster reading projections |

Before returning an indexed body the server checks the source file's SHA-256,
that the source is a registered book, that every slice lies inside the source
and on the page it claims, that slices do not overlap, and that the entry's
own heading is included. A monster body must also match its own fingerprint,
start with its own `## Name` heading and contain no other `##` heading.

If any check fails the whole index is ignored for that call: the response
starts with a `WARNING: ... body index invalid/ignored` line and falls back to
the legacy lookup. A name the index does not cover also falls back, with a
caution that the window may be incomplete when an index exists.

Identity is exact after case and punctuation normalization (`Broken-Spell`
matches `Broken Spell`; `Broken Bells` does not). With alias expansion, the
literal query wins over related names from `lookup_aliases.json`.

### Spell and item index

```json
{
  "schema_version": 1,
  "entry_count": 1,
  "reviewed_on": "2026-01-01",
  "sources": {
    "syn": { "file": "_full_source_syn.md", "sha256": "<64 hex>" }
  },
  "entries": [
    {
      "book": "syn",
      "name": "Example Spell",
      "heading": { "line": 120, "pdf_page": 12 },
      "fragments": [
        { "pdf_page": 12, "column": "L", "slices": [[120, 0, 31], [121, 0, 28]] },
        { "pdf_page": 12, "column": "R", "slices": [[96, 40, 77]] }
      ],
      "repairs": [
        { "line": 121, "column": "L", "before": "Damage: ld6",
          "after": "Damage: 1d6", "evidence": "Checked against PDF page 12." }
      ],
      "warnings": ["Printed table header is partly illegible."]
    }
  ]
}
```

- `sources.<code>.file` is the registered cache path relative to the library
  root, exactly as `extraction_manifest.json` resolves it.
- A slice is `[line, start, end]`: 1-based line, 0-based character offsets,
  end exclusive. Fragments are returned in array order, so a continuation can
  come from an earlier line of the right column or from a later page.
- `column` is `L` or `R` for a physical PDF column, or `S` for a source stream
  whose physical column is not certified. `pdf_page` is `null` for a
  single-column source without page headings.
- `repairs` are optional OCR corrections. `before` must equal the slice text
  exactly or the index is rejected; the response states how many corrections
  were applied.
- Item entries may add `aliases` (printed nicknames) and `variant_aliases`
  (a subset of `aliases`). A variant alias returns the printed base card with a
  caution that the variant is not calculated for you.

### Monster index

```json
{
  "schema_version": 1,
  "entry_count": 1,
  "reviewed_on": "2026-01-01",
  "sources": {
    "syn": {
      "file": "_full_source_syn.md", "sha256": "<64 hex>",
      "reading_file": "lookups/monster_bodies/syn.md", "reading_sha256": "<64 hex>"
    }
  },
  "entries": [
    {
      "book": "syn", "name": "Example Beast", "aliases": [],
      "heading": { "line": 400, "pdf_page": 30 },
      "body": { "start": 12, "end": 58, "sha256": "<64 hex of those lines>" },
      "complete": true,
      "warnings": [],
      "source_pages": [30, 31]
    }
  ]
}
```

`reading_file` is either the registered source itself (for an already
single-column Markdown source) or a generated projection under
`lookups/monster_bodies/`; any other path, or a symlink leaving that folder,
is rejected. `complete: false` is shown as *extraction review required* and
never as a complete card.

## Building an index

You do not write index files by hand. You write a *layout* that records your
review of one or more caches, and a builder turns it into the index. The
builders refuse to run when a cache's SHA-256 differs from the layout: a
changed cache needs a fresh review, not a refreshed hash.

```sh
# spells (and, with --kind item, items) from a spell/item layout
python3 scripts/build-spell-body-index.py --sources-root DIR --layout spell-layout.json
python3 scripts/build-spell-body-index.py --sources-root DIR --layout spell-layout.json --check

# monsters
python3 scripts/build-monster-body-index.py --sources-root DIR --layout monster-layout.json
python3 scripts/build-monster-body-index.py --sources-root DIR --layout monster-layout.json --check

# end-to-end: every indexed slice comes back through the MCP server, in order
node scripts/verify-body-index.mjs DIR/my-library --kind spell
```

`DIR` is the folder that contains your libraries; each layout book names its
library with `folder` (and optionally a different `index_folder` for where the
index is written). `--check` rewrites nothing and fails if a generated file is
missing or stale. Keep your layouts next to your private library.

### Spell and item layout

```json
{
  "kind": "spell",
  "reviewed_on": "2026-01-01",
  "books": {
    "syn": {
      "folder": "my-library",
      "file": "_full_source_syn.md",
      "sha256": "<64 hex>",
      "pages": { "12": 40, "13": 38 },
      "headings": [
        { "name": "Example Spell", "line": 120, "column": "L", "pdf_page": 12 }
      ],
      "exclude": [[140, "R"]],
      "attachments": [
        { "name": "Example Spell", "pdf_page": 13, "column": "L",
          "line_start": 150, "line_end": 158 }
      ]
    }
  }
}
```

- `kind` is `spell` (default) or `item` and must match `--kind`.
- `pages` lists the PDF pages to read and, for each, the character column of
  its gutter. Each row is split into `L` and `R` cells at the run of spaces
  nearest the gutter. Each heading owns every cell from its own position in
  reading order (left column, then right, page by page) up to the next
  heading.
- `exclude` drops cells such as running heads, footers and figure captions.
  `attachments` move a detached table or stat block to the entry it belongs to.
- Optional per book: `single_column: true` or `single_stream_pages: [n]` for
  pages read as one stream; `start_line` / `end_line`; `cell_overrides`
  (`{ "line": n, "slices": [[start, end, "L"], ...] }`) for rows the gutter
  split gets wrong; per heading `stop` (`{ "line", "column" }`) to end an
  entry early, plus `aliases` / `variant_aliases` for items.
- Optional maps keyed by entry name: `reading_orders` (an explicit cell order,
  which must contain every owned cell exactly once), `warnings`, and `repairs`.
- `"format": "markdown"` (with an optional `"section": "# Heading"`) reads an
  already-structured single-column source in which each entry is a `## Name`
  heading.

### Monster layout

```json
{
  "reviewed_on": "2026-01-01",
  "books": {
    "syn": {
      "folder": "my-library",
      "file": "_full_source_syn.md",
      "sha256": "<64 hex>",
      "entries": [
        {
          "name": "Example Beast",
          "heading": { "line": 400, "pdf_page": 30 },
          "slices": [[401, 0, 38, "L"], [402, 0, 41, "L"], [380, 44, 90, "R"]],
          "complete": true,
          "warnings": [],
          "source_pages": [30]
        }
      ]
    }
  }
}
```

Slices are `[line, start, end, column]`, emitted in order into the generated
projection under `lookups/monster_bodies/`. Two entries cannot claim the same
characters. When an entry spans pages, `source_pages` must list every page its
slices use.
Optional per entry: `aliases`, `variant_notes`, `repairs` (`before` must occur
in the slice), and, for text the OCR layer lost entirely, `insertions`,
`recovered_header` or `body_recovery`, each with
`evidence: { "pdf_page", "pdf_sha256", "checked" }` describing how you checked
it against your PDF. `"format": "markdown"` indexes `## Name` cards that show
both AC and HP in an already-structured source.
