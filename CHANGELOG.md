# Changelog

## 0.1.0 - unreleased

First public release candidate: the local read-only MCP server with eight
lookup tools, two-column OCR reading-order reconstruction, structured
spell-access and rule-table lookups, MIT license, security notes, a library
format reference, and an original synthetic example library.

- Opened files and `lookups/` routing cards are checked against their real
  paths, so symbolic links cannot read outside the library root; registered
  books and fixed sibling sources keep working.
- The spell-access provenance line is read from the catalog's
  `provenance.source` instead of a fixed label.
- The default test suite uses synthetic data only.
