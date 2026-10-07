# Rules library format

A library root is the directory named by `CORE_RULES_PATH`. Every tool call
reloads it, so edits take effect on the next call. The files below are what
the server reads; `examples/synthetic-rules-library` contains a complete,
working instance of each one with invented content.

Build libraries only from material you are entitled to use, and keep them out
of public repositories and bug reports.

## Files

| File | Required | Purpose |
| --- | --- | --- |
| `extraction_manifest.json` | yes | Registers books and their full-source caches. |
| `_full_source_<code>.md` | per book | Page-anchored book text. |
| `pdf_page_map.json` | yes | Maps cache line ranges to PDF pages. |
| `lookup_catalog.json` | yes | Known entry locations by name and category. |
| `lookup_aliases.json` | yes | Alternative names and spellings. |
| `lookups/spell_access_catalog.json` | yes | Structured spell-access records. |
| `lookups/structured_rule_tables.json` | no | Curated, page-verified tables. |
| `lookups/*.md` | no | Routing cards searched for rule queries. |

If any required file is missing or invalid, every tool returns an error until
it is fixed. A minimal valid set is `pdf_page_map.json` = `{}`,
`lookup_catalog.json` = `[]`, `lookup_aliases.json` =
`{"known_variants": {}}`, and a spell-access catalog with no entries:

```json
{ "schema_version": 1, "edition": "my-edition", "entries": {}, "entry_count": 0 }
```

## extraction_manifest.json

```json
{
  "library": "My rules library",
  "books": [
    {
      "code": "mybook",
      "short": "MYBOOK",
      "title": "My Rulebook",
      "full_source_file": "_full_source_mybook.md",
      "full_source_lines": 12345,
      "priority": "primary rules source"
    }
  ]
}
```

- `library` is the label shown by `list_core_books` unless
  `CORE_RULES_LABEL` is set.
- `code` must be lowercase; it is how `books` filters select a book. See the
  README for codes with built-in behaviour.
- `short` labels every result header.
- `full_source_file` is a file name directly under the root (no
  subdirectory). Name it `_full_source*.md` to make it eligible for two-column
  reading-order reconstruction.
- `full_source_lines` and `priority` are informational. `full_source_lines`
  also bounds `source.line` in structured tables.

## Full-source caches

Plain Markdown with one heading per PDF page:

````markdown
## PDF Page 12

```text
page text, with OCR layout spacing kept
```
````

- `## PDF Page N` on its own line marks the page. The `text` fence is
  optional.
- Put entry titles on their own heading lines, for example `### Lantern Spark`.
  Spell, monster, item, and rule lookups find entries by heading.
- Spell bodies need at least three of `Casting Time:`, `Range:`,
  `Components:`, and `Duration:` near the title. Inside a `## PDF Page` block,
  the title must also be followed within a few lines by a level line
  (`Level 1 Evocation`, `1st-level evocation`, or `... Cantrip`) and then
  `Casting Time:`. Keep these labels plain, not bold.
- Monster bodies need at least four of Armor Class, Hit Points, Speed,
  Challenge, and an STR/DEX/CON row.
- Item bodies need a type-and-rarity line such as `Wondrous item, uncommon`,
  or `Rarity:` followed by `Type:`.
- Two-column pages are reconstructed only when the gutter is unambiguous and
  one column runs on its own for a few wrapped rows; otherwise the page stays
  in source order and results say so.

## pdf_page_map.json

```json
{ "mybook": { "pages": [ { "pdf_page": 1, "line_start": 1, "line_end": 40 } ] } }
```

Line numbers are 1-based and inclusive. List pages in ascending, non-overlapping
order; lookups use binary search. Keep the map consistent with the
`## PDF Page` headings, which drive reading-order reconstruction separately.

## lookup_catalog.json

```json
[
  {
    "name": "Lantern Spark",
    "category": "spell",
    "books": [ { "code": "mybook", "hits": [ { "line": 20, "pdf_page": 2 } ] } ]
  }
]
```

- `category` is `spell`, `monster`, `item`, or a rule category: `rule`,
  `rules`, `procedure`, `action`, `dm-procedure`, `optional-module`,
  `class-option`, `feat`, `monster-rule`, `monster-index`, `lore-topic`, or
  `setting`.
- `name` matches case-insensitively. Entries for books that are not installed
  are skipped.
- Catalog entries are optional for headed spells, monsters, and items, which
  are also found by heading. They are needed for `search_core_rules` with
  `match=all_terms` to anchor on a Title Case heading.

## lookup_aliases.json

```json
{ "known_variants": { "Lantern Spark": ["Amber Mote"] } }
```

Aliases work in both directions and compare letters and digits only.
`lookup_spell` matches spell bodies by the requested name, so prefer canonical
spell names there; aliases do work for `lookup_spell_access`, monsters, items,
and rule topics.

## lookups/spell_access_catalog.json

```json
{
  "schema_version": 1,
  "edition": "my-edition",
  "provenance": { "source": "my curated catalog", "upstream_revision": "2026-10-01" },
  "entry_count": 1,
  "entries": {
    "lantern spark": {
      "name": "Lantern Spark",
      "level": 1,
      "spell_sources": [ { "source": "MYBOOK", "page": 2 } ],
      "base_classes": [ { "class_name": "Wizard", "class_source": "MYBOOK" } ],
      "optional_class_lists": [
        { "class_name": "Tinker", "class_source": "MYBOOK", "defined_in_sources": ["MYBOOK Optional Rules"] }
      ],
      "conditional_access": [
        {
          "class_name": "Fighter",
          "feature_name": "Cog Knight Sparkcraft",
          "access_type": "subclass",
          "mode": "always_prepared",
          "minimum_class_level": 3,
          "semantics": "audited",
          "detail": "Cog Knights of 3rd level always have this spell prepared.",
          "source_ref": "MYBOOK p.5"
        }
      ]
    }
  }
}
```

- `entry_count` must equal the number of entries.
- Entry keys are normalized names: Unicode NFKC, curly apostrophes made
  straight, whitespace collapsed, lowercase.
- `edition` is checked only for the built-in `phb14` (`2014`) and `phb24`
  (`2024`) codes.
- `provenance.source` and `provenance.upstream_revision` are printed with every
  answer.
- `semantics: "audited"` is shown as audited; any other value is shown as
  discovery-only.
- `access_type` is typically `subclass`, `optional_feature`, `feat`, `race`,
  `background`, or `reward`. `mode` defaults to "conditional feature".
- Class filters accept any class name that appears in the catalog, plus
  English plurals and Chinese names for the standard classes.

## lookups/structured_rule_tables.json

```json
{
  "schema_version": 1,
  "entry_count": 1,
  "entries": {
    "upkeep_costs": {
      "title": "Upkeep Costs",
      "aliases": ["gear upkeep prices"],
      "book": "mybook",
      "columns": ["Item", "Cost"],
      "rows": [["Brass winding key", "2 sp"]],
      "source": { "file": "_full_source_mybook.md", "line": 12, "pdf_page": 1, "verification": "checked against PDF page 1" }
    }
  }
}
```

A table is returned by `lookup_rule_topic` when the topic matches its title or
an alias, before any OCR search. `book` must be installed, `source.file` must
equal that book's `full_source_file`, and every row must have one cell per
column. The output cites the unchanged source line and page, which remain
authoritative.

## lookups/*.md

Routing cards are short Markdown notes that point to the right book, page, or
tool. They are searched first by `search_core_rules` for `type=all` or
`type=rule` without a `books` filter, and used as a last resort by
`lookup_rule_topic`, also only without a `books` filter. They are never
reflowed. Store them as regular files: a
symbolic link that leaves the library root makes the library fail to load.
