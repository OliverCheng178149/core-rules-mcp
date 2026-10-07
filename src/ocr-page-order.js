const PAGE_HEADING = /^## PDF Page (\d+)\s*$/;
const TEXT_FENCE = /^```text\s*$/i;
const CLOSING_FENCE = /^```\s*$/;
const WHITESPACE_RUN = / {2,}/g;

const MIN_GUTTER_SUPPORT = 4;
const MIN_INDEPENDENT_FLOW_RUN = 3;
const MIN_INDEPENDENT_FLOW_CHARS = 60;
const MIN_SUBSTANTIVE_CHARS = 3;
const MIN_NUMBERED_TABLE_ANCHORS = 3;
const GUTTER_TOLERANCE = 10;
const MIN_WINNING_MARGIN = 2;
const MIN_WINNING_RATIO = 1.25;
const DICE_TABLE_HEADER = /^d(\d{1,3})\s+\S/i;
const NUMBERED_TABLE_ROW = /^(\d{1,3})\s+\S/;
const TRAILING_TABLE_NUMBER = /^(.*\S)\s+(\d{1,3})$/;

function substantiveLength(text) {
  return (text.match(/[A-Za-z0-9]/g) || []).length;
}

function sourceEntries(rows) {
  return rows
    .filter(row => row.text.trim())
    .map(row => ({
      sourceLine: row.sourceLine,
      column: "S",
      text: row.text.trim()
    }));
}

function pageRows(lines, sourceLine) {
  const targetIndex = Math.min(Math.max(sourceLine - 1, 0), lines.length - 1);
  let headingIndex = -1;
  let pageNumber = null;

  for (let index = targetIndex; index >= 0; index -= 1) {
    const match = lines[index].match(PAGE_HEADING);
    if (match) {
      headingIndex = index;
      pageNumber = Number.parseInt(match[1], 10);
      break;
    }
  }

  if (headingIndex < 0) {
    return {
      recognized: false,
      pageNumber,
      rows: lines.map((text, index) => ({ sourceLine: index + 1, text }))
    };
  }

  let start = headingIndex + 1;
  let end = lines.length - 1;
  for (let index = start; index < lines.length; index += 1) {
    if (PAGE_HEADING.test(lines[index])) {
      end = index - 1;
      break;
    }
  }

  while (start <= end && !lines[start].trim()) start += 1;
  while (end >= start && !lines[end].trim()) end -= 1;

  if (start <= end && TEXT_FENCE.test(lines[start]) && CLOSING_FENCE.test(lines[end])) {
    start += 1;
    end -= 1;
    while (start <= end && !lines[start].trim()) start += 1;
    while (end >= start && !lines[end].trim()) end -= 1;
  }

  const rows = [];
  for (let index = start; index <= end; index += 1) {
    rows.push({ sourceLine: index + 1, text: lines[index] });
  }
  return { recognized: true, pageNumber, rows };
}

function candidateScores(rows) {
  const width = Math.max(0, ...rows.map(row => row.text.trimEnd().length));
  const minimum = Math.ceil(width * 0.3);
  const maximum = Math.floor(width * 0.7);
  const scores = new Map();

  for (const { text } of rows) {
    for (const match of text.matchAll(WHITESPACE_RUN)) {
      const runStart = match.index;
      const runEnd = runStart + match[0].length;
      const first = Math.max(minimum, runStart + 1);
      const last = Math.min(maximum, runEnd - 1);

      for (let position = first; position <= last; position += 1) {
        if (
          substantiveLength(text.slice(0, position)) >= MIN_SUBSTANTIVE_CHARS
          && substantiveLength(text.slice(position)) >= MIN_SUBSTANTIVE_CHARS
        ) {
          scores.set(position, (scores.get(position) || 0) + 1);
        }
      }
    }
  }
  return scores;
}

function inferGutter(rows) {
  const scores = candidateScores(rows);
  const supported = [...scores]
    .filter(([, score]) => score >= MIN_GUTTER_SUPPORT)
    .sort(([left], [right]) => left - right);
  const groups = [];

  for (const [position, score] of supported) {
    const group = groups.at(-1);
    if (!group || position > group.at(-1).position + 1) {
      groups.push([{ position, score }]);
    } else {
      group.push({ position, score });
    }
  }

  const candidates = groups.map(group => {
    const score = Math.max(...group.map(item => item.score));
    const peakPositions = group
      .filter(item => item.score === score)
      .map(item => item.position);
    return {
      position: Math.round(peakPositions.reduce((sum, value) => sum + value, 0) / peakPositions.length),
      score
    };
  }).sort((left, right) => right.score - left.score);

  const winner = candidates[0];
  if (!winner) return null;

  const runnerUp = candidates[1];
  if (
    runnerUp
    && (
      winner.score - runnerUp.score < MIN_WINNING_MARGIN
      || winner.score / runnerUp.score < MIN_WINNING_RATIO
    )
  ) {
    return null;
  }
  return winner;
}

function splitRunFor(text, gutter) {
  const runs = [];
  for (const match of text.matchAll(WHITESPACE_RUN)) {
    const start = match.index;
    const end = start + match[0].length;
    if (
      substantiveLength(text.slice(0, start)) < MIN_SUBSTANTIVE_CHARS
      || substantiveLength(text.slice(end)) < MIN_SUBSTANTIVE_CHARS
    ) {
      continue;
    }
    const distance = gutter < start
      ? start - gutter
      : gutter > end
        ? gutter - end
        : 0;
    runs.push({ start, end, distance });
  }

  runs.sort((left, right) => left.distance - right.distance);
  return runs[0]?.distance <= GUTTER_TOLERANCE ? runs[0] : null;
}

function oneSidedRunFor(text, gutter) {
  const runs = [];
  for (const match of text.matchAll(WHITESPACE_RUN)) {
    const start = match.index;
    const end = start + match[0].length;
    const leftLength = substantiveLength(text.slice(0, start));
    const rightLength = substantiveLength(text.slice(end));
    if (
      (leftLength >= MIN_SUBSTANTIVE_CHARS) === (rightLength >= MIN_SUBSTANTIVE_CHARS)
    ) {
      continue;
    }
    const distance = gutter < start
      ? start - gutter
      : gutter > end
        ? gutter - end
        : 0;
    runs.push({ start, end, distance, leftLength, rightLength });
  }

  runs.sort((left, right) => left.distance - right.distance);
  return runs[0]?.distance <= GUTTER_TOLERANCE ? runs[0] : null;
}

function numberedTableSignal(row, maximum) {
  const rightMatch = row.right?.match(NUMBERED_TABLE_ROW);
  if (rightMatch && Number.parseInt(rightMatch[1], 10) <= maximum) {
    return { number: Number.parseInt(rightMatch[1], 10), kind: "anchor" };
  }

  const leftMatch = row.kind === "left" && row.left.match(NUMBERED_TABLE_ROW);
  if (leftMatch && Number.parseInt(leftMatch[1], 10) <= maximum) {
    return { number: Number.parseInt(leftMatch[1], 10), kind: "left" };
  }

  const trailingMatch = row.kind === "split" && row.left.match(TRAILING_TABLE_NUMBER);
  if (trailingMatch && Number.parseInt(trailingMatch[2], 10) <= maximum) {
    return {
      number: Number.parseInt(trailingMatch[2], 10),
      kind: "trailing",
      left: trailingMatch[1].trimEnd()
    };
  }
  return null;
}

function repairNumberedTableContinuations(classified) {
  const repaired = classified.map(row => ({ ...row }));

  for (let headerIndex = 0; headerIndex < repaired.length; headerIndex += 1) {
    const headerMatch = repaired[headerIndex].right?.match(DICE_TABLE_HEADER);
    if (!headerMatch) continue;

    const maximum = Number.parseInt(headerMatch[1], 10);
    if (maximum < MIN_NUMBERED_TABLE_ANCHORS) continue;

    const signals = [];
    for (let index = headerIndex + 1; index < repaired.length; index += 1) {
      const signal = numberedTableSignal(repaired[index], maximum);
      if (!signal) continue;
      signals.push({ ...signal, index });
      if (signal.number === maximum) break;
    }

    const candidates = signals.filter(signal => signal.kind !== "anchor");
    if (candidates.length === 0) continue;

    const anchors = signals.filter(signal => signal.kind === "anchor");
    const hasCompleteSequence = signals.length === maximum
      && signals.every((signal, index) => signal.number === index + 1);
    if (anchors.length < MIN_NUMBERED_TABLE_ANCHORS || !hasCompleteSequence) {
      return null;
    }

    for (const candidate of candidates) {
      const row = repaired[candidate.index];
      if (candidate.kind === "left") {
        repaired[candidate.index] = {
          sourceLine: row.sourceLine,
          right: row.left,
          kind: "right"
        };
      } else {
        repaired[candidate.index] = {
          ...row,
          left: candidate.left,
          right: `${candidate.number} ${row.right}`
        };
      }
    }
  }
  return repaired;
}

function hasIndependentFlow(classified) {
  let previousColumn = null;
  let previousSourceLine = null;
  let previousText = "";
  let runLength = 0;
  let runChars = 0;
  let hasWrappedContinuation = false;

  for (const row of classified) {
    const column = row.kind === "left" || row.kind === "right" ? row.kind : null;
    const text = column ? row.left || row.right : "";
    if (column && column === previousColumn && row.sourceLine === previousSourceLine + 1) {
      runLength += 1;
      runChars += substantiveLength(text);
      hasWrappedContinuation ||= /^[a-z]/.test(text) || previousText.endsWith("-");
    } else {
      runLength = column ? 1 : 0;
      runChars = column ? substantiveLength(text) : 0;
      hasWrappedContinuation = false;
    }
    if (
      runLength >= MIN_INDEPENDENT_FLOW_RUN
      && runChars >= MIN_INDEPENDENT_FLOW_CHARS
      && hasWrappedContinuation
    ) {
      return true;
    }
    previousColumn = column;
    previousSourceLine = row.sourceLine;
    previousText = text;
  }
  return false;
}

function columnEntries(rows, gutter) {
  const classified = [];

  for (const row of rows) {
    if (!row.text.trim()) continue;

    const splitRun = splitRunFor(row.text, gutter.position);
    if (splitRun) {
      classified.push({
        sourceLine: row.sourceLine,
        left: row.text.slice(0, splitRun.start).trim(),
        right: row.text.slice(splitRun.end).trim(),
        kind: "split"
      });
      continue;
    }

    const oneSidedRun = oneSidedRunFor(row.text, gutter.position);
    if (oneSidedRun) {
      if (oneSidedRun.leftLength >= MIN_SUBSTANTIVE_CHARS) {
        classified.push({
          sourceLine: row.sourceLine,
          left: row.text.slice(0, oneSidedRun.start).trim(),
          kind: "left"
        });
      } else {
        classified.push({
          sourceLine: row.sourceLine,
          right: row.text.slice(oneSidedRun.end).trim(),
          kind: "right"
        });
      }
      continue;
    }

    const first = row.text.search(/\S/);
    const last = row.text.search(/\s*$/) - 1;
    if (last < gutter.position) {
      classified.push({ sourceLine: row.sourceLine, left: row.text.trim(), kind: "left" });
    } else if (first >= gutter.position) {
      classified.push({ sourceLine: row.sourceLine, right: row.text.trim(), kind: "right" });
    } else {
      classified.push({ sourceLine: row.sourceLine, text: row.text.trim(), kind: "spanning" });
    }
  }

  const repaired = repairNumberedTableContinuations(classified);
  if (!repaired || !hasIndependentFlow(repaired)) return null;

  const columnRows = repaired.filter(row => row.kind !== "spanning");
  const firstColumn = columnRows[0]?.sourceLine;
  const lastColumn = columnRows.at(-1)?.sourceLine;
  const spanning = repaired.filter(row => row.kind === "spanning");
  if (spanning.some(row => row.sourceLine > firstColumn && row.sourceLine < lastColumn)) {
    return null;
  }

  const top = spanning
    .filter(row => row.sourceLine <= firstColumn)
    .map(row => ({ sourceLine: row.sourceLine, column: "S", text: row.text }));
  const left = repaired
    .filter(row => row.left)
    .map(row => ({ sourceLine: row.sourceLine, column: "L", text: row.left }));
  const right = repaired
    .filter(row => row.right)
    .map(row => ({ sourceLine: row.sourceLine, column: "R", text: row.right }));
  const bottom = spanning
    .filter(row => row.sourceLine >= lastColumn)
    .map(row => ({ sourceLine: row.sourceLine, column: "S", text: row.text }));

  return [...top, ...left, ...right, ...bottom];
}

export function pageViewForLine(lines, sourceLine) {
  const { recognized, pageNumber, rows } = pageRows(lines, sourceLine);
  const sourceStart = rows[0]?.sourceLine ?? sourceLine;
  const sourceEnd = rows.at(-1)?.sourceLine ?? sourceLine;
  const gutter = recognized && inferGutter(rows);
  const entries = gutter && columnEntries(rows, gutter);

  return {
    mode: entries ? "columns" : "source",
    pageNumber,
    sourceStart,
    sourceEnd,
    entries: entries || sourceEntries(rows)
  };
}

export function formatPageEntries(entries) {
  return entries
    .map(entry => `${entry.sourceLine}${entry.column} | ${entry.text}`)
    .join("\n");
}

function parseSelector(selector) {
  if (selector === undefined || selector === null) {
    return { provided: false, column: null, text: "" };
  }
  if (typeof selector === "string") {
    const text = selector.trim().toLocaleLowerCase();
    return { provided: Boolean(text), column: null, text };
  }
  if (typeof selector !== "object" || Array.isArray(selector)) {
    throw new TypeError("Selector must be a string or an object with column and optional text");
  }

  const keys = Object.keys(selector);
  if (keys.some(key => key !== "column" && key !== "text")) {
    throw new TypeError("Selector object supports only column and text");
  }
  if (selector.column !== undefined && selector.column !== "L" && selector.column !== "R") {
    throw new TypeError('Selector column must be "L" or "R"');
  }
  if (selector.text !== undefined && typeof selector.text !== "string") {
    throw new TypeError("Selector text must be a string");
  }

  const column = selector.column ?? null;
  const text = selector.text?.trim().toLocaleLowerCase() ?? "";
  if (!column && !text) {
    throw new TypeError("Selector object must include column or text");
  }
  return { provided: true, column, text };
}

function entryIndexForLine(entries, sourceLine, selector) {
  const selection = parseSelector(selector);
  const candidates = entries
    .map((entry, index) => ({ entry, index }))
    .filter(candidate => candidate.entry.sourceLine === sourceLine);
  if (candidates.length === 0) return -1;

  if (selection.provided) {
    const matches = candidates.filter(candidate => (
      (!selection.column || candidate.entry.column === selection.column)
      && (!selection.text || candidate.entry.text.toLocaleLowerCase().includes(selection.text))
    ));
    if (matches.length === 1) return matches[0].index;
    if (matches.length === 0) {
      throw new RangeError(`No cell at source line ${sourceLine} matches the selector`);
    }
    throw new RangeError(`Selector matches multiple cells at source line ${sourceLine}`);
  }

  if (candidates.length > 1) {
    throw new RangeError(`Source line ${sourceLine} is ambiguous; provide a selector`);
  }
  return candidates[0].index;
}

export function logicalWindowForLine(lines, sourceLine, contextLines, selector) {
  const view = pageViewForLine(lines, sourceLine);
  const target = entryIndexForLine(view.entries, sourceLine, selector);
  if (target < 0) {
    return {
      mode: view.mode,
      pageNumber: view.pageNumber,
      start: sourceLine,
      end: sourceLine,
      text: ""
    };
  }

  const context = Math.max(0, Math.trunc(contextLines));
  const entries = view.entries.slice(
    Math.max(0, target - context),
    Math.min(view.entries.length, target + context + 1)
  );
  return {
    mode: view.mode,
    pageNumber: view.pageNumber,
    start: entries[0].sourceLine,
    end: entries.at(-1).sourceLine,
    text: formatPageEntries(entries)
  };
}

export function logicalForwardFromLine(lines, sourceLine, maxLines, selector) {
  const view = pageViewForLine(lines, sourceLine);
  const target = entryIndexForLine(view.entries, sourceLine, selector);
  if (target < 0) return "";

  const limit = Math.max(0, Math.trunc(maxLines));
  return view.entries
    .slice(target, target + limit)
    .map(entry => entry.text)
    .join("\n");
}
