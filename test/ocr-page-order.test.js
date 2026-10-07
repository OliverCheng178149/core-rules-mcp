import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPageEntries,
  logicalForwardFromLine,
  logicalWindowForLine,
  pageViewForLine
} from "../src/ocr-page-order.js";

// Original synthetic pages; no text is taken from a published book.
const GUTTER = 42;
const row = (left, right = "") => (right ? `${left.padEnd(GUTTER)}${right}` : left);

// A spell page laid out like a two-column OCR row dump. The left column runs
// alone for its first rows, then both columns share each physical row. Source
// line numbers below are 1-based positions in this array.
const SPELL_PAGE = [
  "## PDF Page 7",                                                    // 1
  "",                                                                 // 2
  "```text",                                                          // 3
  row("LANTERN SPARK"),                                               // 4
  row("1st-level evocation"),                                         // 5
  row("A mote of warm light leaps from your"),                        // 6
  row("palm and settles on a point you can"),                         // 7
  row("see within range. The mote sheds dim"),                        // 8
  row("light in a 10-foot radius until the", "keeps its tension until the spell"), // 9
  row("spell ends.", "ends."),                                        // 10
  row("QUIET GEARS", "TINKER'S MEND"),                                // 11
  row("2nd-level transmutation", "1st-level transmutation"),          // 12
  row("Casting Time: 1 action", "Casting Time: 1 action"),            // 13
  row("Range: 30 feet", "Range: touch"),                              // 14
  row("For the duration, no clockwork device", "If a small device is cracked, you can"), // 15
  row("within range can tick or chime, and", "seal the crack with a drop of copper"),  // 16
  row("any device already wound", "that cools at once."),             // 17
  "```",                                                              // 18
  "",                                                                 // 19
  "## PDF Page 8",                                                    // 20
  "Next page text."                                                   // 21
];

function assertTextOrder(text, phrases) {
  let previous = -1;
  for (const phrase of phrases) {
    const index = text.indexOf(phrase, previous + 1);
    assert.notEqual(index, -1, `missing ordered phrase: ${phrase}`);
    assert.ok(index > previous, `out-of-order phrase: ${phrase}`);
    previous = index;
  }
}

test("a two-column page reads the left column before the right column", () => {
  const view = pageViewForLine(SPELL_PAGE, 11);

  assert.equal(view.mode, "columns");
  assert.equal(view.pageNumber, 7);
  assert.equal(view.sourceStart, 4);
  assert.equal(view.sourceEnd, 17);
  assert.deepEqual(
    view.entries.find(entry => entry.sourceLine === 11 && entry.column === "L"),
    { sourceLine: 11, column: "L", text: "QUIET GEARS" }
  );
  assert.deepEqual(
    view.entries.find(entry => entry.sourceLine === 9 && entry.column === "R"),
    { sourceLine: 9, column: "R", text: "keeps its tension until the spell" }
  );

  const quietGears = logicalForwardFromLine(SPELL_PAGE, 11, 12, "QUIET GEARS");
  assertTextOrder(quietGears, [
    "QUIET GEARS",
    "For the duration, no clockwork device",
    "any device already wound",
    "keeps its tension until the spell",
    "TINKER'S MEND"
  ]);
  assert.doesNotMatch(quietGears, /LANTERN SPARK/);
});

test("formatPageEntries exposes original line and column provenance", () => {
  const view = pageViewForLine(SPELL_PAGE, 11);
  const entries = [
    view.entries.find(entry => entry.sourceLine === 17 && entry.column === "L"),
    view.entries.find(entry => entry.sourceLine === 9 && entry.column === "R")
  ];

  assert.equal(
    formatPageEntries(entries),
    "17L | any device already wound\n"
      + "9R | keeps its tension until the spell"
  );
});

test("logicalWindowForLine slices around the target in reconstructed order", () => {
  const window = logicalWindowForLine(SPELL_PAGE, 17, 1, "any device already wound");

  assert.equal(window.mode, "columns");
  assert.equal(window.pageNumber, 7);
  assert.equal(
    window.text,
    "16L | within range can tick or chime, and\n"
      + "17L | any device already wound\n"
      + "9R | keeps its tension until the spell"
  );
});

test("duplicate physical lines require a selector for logical addressing", () => {
  assert.throws(
    () => logicalWindowForLine(SPELL_PAGE, 15, 0),
    error => error instanceof RangeError && /source line 15.*selector/i.test(error.message)
  );
  assert.throws(
    () => logicalForwardFromLine(SPELL_PAGE, 15, 2),
    error => error instanceof RangeError && /source line 15.*selector/i.test(error.message)
  );
});

test("a text selector addresses either cell sharing a source line", () => {
  assert.equal(
    logicalWindowForLine(SPELL_PAGE, 15, 0, "For the duration").text,
    "15L | For the duration, no clockwork device"
  );
  assert.equal(
    logicalWindowForLine(SPELL_PAGE, 15, 0, "If a small device").text,
    "15R | If a small device is cracked, you can"
  );
  assert.equal(
    logicalForwardFromLine(SPELL_PAGE, 15, 2, "For the duration"),
    "For the duration, no clockwork device\nwithin range can tick or chime, and"
  );
  assert.equal(
    logicalForwardFromLine(SPELL_PAGE, 15, 2, "If a small device"),
    "If a small device is cracked, you can\nseal the crack with a drop of copper"
  );
});

test("identical duplicate cells remain ambiguous without an explicit column", () => {
  assert.throws(
    () => logicalWindowForLine(SPELL_PAGE, 13, 0),
    error => error instanceof RangeError && /source line 13.*selector/i.test(error.message)
  );
  assert.throws(
    () => logicalForwardFromLine(SPELL_PAGE, 13, 2, "Casting Time: 1 action"),
    error => error instanceof RangeError && /multiple cells.*13/i.test(error.message)
  );
  assert.throws(
    () => logicalWindowForLine(SPELL_PAGE, 13, 0, { text: "Casting Time: 1 action" }),
    error => error instanceof RangeError && /multiple cells.*13/i.test(error.message)
  );
});

test("structured column selectors address identical cells", () => {
  assert.equal(
    logicalWindowForLine(SPELL_PAGE, 13, 0, { column: "L", text: "Casting Time: 1 action" }).text,
    "13L | Casting Time: 1 action"
  );
  assert.equal(
    logicalWindowForLine(SPELL_PAGE, 13, 0, { column: "R" }).text,
    "13R | Casting Time: 1 action"
  );
  assert.equal(
    logicalForwardFromLine(SPELL_PAGE, 13, 2, { column: "L" }),
    "Casting Time: 1 action\nRange: 30 feet"
  );
  assert.equal(
    logicalForwardFromLine(SPELL_PAGE, 13, 2, { column: "R", text: "Casting Time: 1 action" }),
    "Casting Time: 1 action\nRange: touch"
  );
});

test("invalid structured selectors fail closed", () => {
  assert.throws(
    () => logicalWindowForLine(SPELL_PAGE, 13, 0, { column: "S" }),
    error => error instanceof TypeError && /selector.*column/i.test(error.message)
  );
  assert.throws(
    () => logicalForwardFromLine(SPELL_PAGE, 13, 2, { column: "L", text: 42 }),
    error => error instanceof TypeError && /selector.*text/i.test(error.message)
  );
  assert.throws(
    () => logicalWindowForLine(SPELL_PAGE, 13, 0, {}),
    error => error instanceof TypeError && /selector/i.test(error.message)
  );
  assert.throws(
    () => logicalWindowForLine(SPELL_PAGE, 13, 0, { column: "L", text: "Range" }),
    error => error instanceof RangeError && /no cell.*13/i.test(error.message)
  );
});

test("one-column pages fall back to source order", () => {
  const lines = [
    "preface",
    "## PDF Page 9",
    "",
    "```text",
    "ONE COLUMN HEADING",
    "First paragraph line.",
    "Second paragraph line.",
    "```",
    "",
    "## PDF Page 10",
    "Next page"
  ];

  const view = pageViewForLine(lines, 6);
  const window = logicalWindowForLine(lines, 6, 1);

  assert.equal(view.mode, "source");
  assert.equal(view.pageNumber, 9);
  assert.equal(view.sourceStart, 5);
  assert.equal(view.sourceEnd, 7);
  assert.deepEqual(view.entries, [
    { sourceLine: 5, column: "S", text: "ONE COLUMN HEADING" },
    { sourceLine: 6, column: "S", text: "First paragraph line." },
    { sourceLine: 7, column: "S", text: "Second paragraph line." }
  ]);
  assert.equal(window.start, 5);
  assert.equal(window.end, 7);
  assert.equal(
    window.text,
    "5S | ONE COLUMN HEADING\n"
      + "6S | First paragraph line.\n"
      + "7S | Second paragraph line."
  );
});

test("aligned one-column key/value rows do not establish two reading flows", () => {
  const lines = [
    "## PDF Page 10",
    "Name                    Value",
    "Alpha                   First",
    "Beta                    Second",
    "Gamma                   Third"
  ];

  const view = pageViewForLine(lines, 3);

  assert.equal(view.mode, "source");
  assert.deepEqual(view.entries, [
    { sourceLine: 2, column: "S", text: "Name                    Value" },
    { sourceLine: 3, column: "S", text: "Alpha                   First" },
    { sourceLine: 4, column: "S", text: "Beta                    Second" },
    { sourceLine: 5, column: "S", text: "Gamma                   Third" }
  ]);
});

test("one-column tables with group and note rows still fail closed", () => {
  const lines = [
    "## PDF Page 11",
    "Name                    Value",
    "Alpha                   First",
    "Group A",
    "                        Notes",
    "Group B",
    "                        More notes",
    "Beta                    Second",
    "Gamma                   Third"
  ];

  const view = pageViewForLine(lines, 5);

  assert.equal(view.mode, "source");
  assert.deepEqual(view.entries.map(entry => entry.column), [
    "S", "S", "S", "S", "S", "S", "S", "S"
  ]);
});

test("short page-edge headings do not establish an independent column flow", () => {
  const lines = [
    "## PDF Page 12",
    "Report",
    "Inventory",
    "August",
    "Name                    Value",
    "Alpha                   First",
    "Beta                    Second",
    "Gamma                   Third"
  ];

  const view = pageViewForLine(lines, 6);

  assert.equal(view.mode, "source");
  assert.deepEqual(view.entries.map(entry => entry.column), [
    "S", "S", "S", "S", "S", "S", "S"
  ]);
});

test("two-column-looking prose outside a PDF page block stays in source order", () => {
  const lines = [
    "Left alpha                              Right alpha",
    "Left beta                               Right beta",
    "Left gamma                              Right gamma",
    "Left delta                              Right delta"
  ];

  const view = pageViewForLine(lines, 2);

  assert.equal(view.mode, "source");
  assert.equal(view.pageNumber, null);
  assert.deepEqual(view.entries.map(entry => entry.column), ["S", "S", "S", "S"]);
});

test("a spanning row among column content forces source-order fallback", () => {
  const lines = [
    "## PDF Page 12",
    "Left-column prelude.",
    "THIS FULL WIDTH ROW CROSSES THE INFERRED GUTTER WITHOUT A GAP",
    "Left alpha                              Right alpha",
    "Left beta                               Right beta",
    "Left gamma                              Right gamma",
    "Left delta                              Right delta"
  ];

  const view = pageViewForLine(lines, 4);

  assert.equal(view.mode, "source");
  assert.deepEqual(view.entries.map(entry => entry.column), ["S", "S", "S", "S", "S", "S"]);
});

// A d6 table in the right column whose third row number was captured at the
// end of the left cell, as OCR sometimes does across a narrow gutter.
const TABLE_PAGE = [
  "## PDF Page 21",
  row("WORKSHOP RUMORS"),
  row("Apprentices trade stories while they"),
  row("sweep the floor, and a clever guide"),
  row("can roll on the table opposite.", "d6 Rumor"),
  row("Each rumor is harmless on its own,", "1 The foreman hides a spare key"),
  row("but two rumors together may hint at", "2 A clock in the hall runs late"),
  row("the real trouble in the workshop 3", "The cellar door hums at night"),
  row("Choose whichever rumor fits the", "4 A crate of gears went missing"),
  row("mood of the scene.", "5 The bell rope was cut and tied"),
  row("", "6 Someone whistles in the attic")
];

test("a numbered right-column table recovers a row number captured on the left", () => {
  const view = pageViewForLine(TABLE_PAGE, 5);

  assert.equal(view.mode, "columns");
  assert.deepEqual(
    view.entries.find(entry => entry.sourceLine === 8 && entry.column === "L"),
    { sourceLine: 8, column: "L", text: "the real trouble in the workshop" }
  );
  assert.deepEqual(
    view.entries.find(entry => entry.sourceLine === 8 && entry.column === "R"),
    { sourceLine: 8, column: "R", text: "3 The cellar door hums at night" }
  );

  const right = logicalForwardFromLine(TABLE_PAGE, 5, 7, { column: "R" });
  const rowNumbers = right
    .split("\n")
    .map(text => text.match(/^(\d+)\s+/))
    .filter(Boolean)
    .map(match => Number.parseInt(match[1], 10));
  assert.deepEqual(rowNumbers, [1, 2, 3, 4, 5, 6]);
});
