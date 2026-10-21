# Changelog

## 0.2.0 - 2026-10-22

Indexed complete bodies: `lookup_spell`, `lookup_item` and `lookup_monster`
can return a whole entry, across columns and pages and without its neighbours,
from an optional reviewed body index in your library. See
`docs/indexed-bodies.md`.

- The server reads `lookups/spell_body_index.json`,
  `lookups/item_body_index.json` and `lookups/monster_body_index.json` when
  present. Source fingerprints, registered paths, page provenance, slice bounds
  and OCR-correction wording are checked on every call; an invalid index is
  ignored with a visible warning and the legacy lookup runs instead. Libraries
  without these files behave as before.
- Indexed bodies are returned in full regardless of `context_lines` and the
  legacy output caps. An item or monster query the index does not cover is
  labelled as a legacy window that may be incomplete.
- Without a `books` filter, an indexed item or monster card is found in any
  registered book, the type's own books first; explicit-only books still need
  `books`.
- New builders `scripts/build-spell-body-index.py` (spells and items) and
  `scripts/build-monster-body-index.py` generate indexes from your own layout
  and refuse to run on a changed cache. `scripts/verify-body-index.mjs` checks
  a generated spell or item index end to end through the server.
- No layouts or indexes are bundled; the new tests use invented fixtures only.
  `npm test` now also runs the builders' Python tests.

## 0.1.1 - 2026-10-22

- Update `@modelcontextprotocol/sdk` to 1.32.1 and refresh the lockfile;
  `npm audit` now reports no known vulnerabilities. The server only uses the
  stdio transport, so the advisories in the SDK's HTTP and OAuth dependencies
  did not reach it, but the lockfile no longer carries them.

## 0.1.0 - 2026-10-08

First public release: the local read-only MCP server with eight
lookup tools, two-column OCR reading-order reconstruction, structured
spell-access and rule-table lookups, MIT license, security notes, a library
format reference, and an original synthetic example library.

- Opened files and `lookups/` routing cards are checked against their real
  paths, so symbolic links cannot read outside the library root; registered
  books and fixed sibling sources keep working.
- The spell-access provenance line is read from the catalog's
  `provenance.source` instead of a fixed label.
- The default test suite uses synthetic data only.
