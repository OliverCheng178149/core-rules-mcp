#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  formatPageEntries,
  logicalWindowForLine,
  pageViewForLine
} from "./ocr-page-order.js";

const DEFAULT_MAX_RESULTS = 8;
const DEFAULT_CONTEXT = 4;
const DEFAULT_LOOKUP_CONTEXT = 18;
const MAX_RESULTS = 30;
const MAX_CONTEXT = 60;
const MAX_BODY_LINES = 180;
const MAX_CHARS = 14000;
const RULE_CATEGORIES = new Set([
  "rule",
  "rules",
  "procedure",
  "action",
  "dm-procedure",
  "optional-module",
  "class-option",
  "feat",
  "monster-rule",
  "monster-index",
  "lore-topic",
  "setting"
]);

const BOOK_ALIASES = {
  phb: "phb14",
  phb14: "phb14",
  "player's handbook": "phb14",
  players: "phb14",
  phb24: "phb24",
  "player's handbook 2024": "phb24",
  "2024 player's handbook": "phb24",
  players24: "phb24",
  dmg: "dmg14",
  dmg14: "dmg14",
  "dungeon master's guide": "dmg14",
  dmg24: "dmg24",
  "dungeon master's guide 2024": "dmg24",
  "2024 dungeon master's guide": "dmg24",
  frhof: "frhof",
  "frhof spells": "frhof",
  "heroes of faerun spells": "frhof",
  "heroes of faerûn spells": "frhof",
  frhof25: "frhof25",
  "frhof full": "frhof25",
  "heroes of faerun full": "frhof25",
  "heroes of faerûn full": "frhof25",
  fraif25: "fraif25",
  fraif: "fraif25",
  "adventures in faerun": "fraif25",
  "adventures in faerûn": "fraif25",
  "forgotten realms: adventures in faerun": "fraif25",
  "forgotten realms: adventures in faerûn": "fraif25",
  "forgotten realms heroes of faerun": "frhof25",
  "forgotten realms heroes of faerûn": "frhof25",
  "forgotten realms: heroes of faerun": "frhof25",
  "forgotten realms: heroes of faerûn": "frhof25",
  "heroes of faerun": "frhof25",
  "heroes of faerûn": "frhof25",
  ftd: "ftd",
  fizban: "ftd",
  "fizban's treasury of dragons": "ftd",
  "fizban’s treasury of dragons": "ftd",
  "fizbans treasury of dragons": "ftd",
  "费兹班的巨龙宝库": "ftd",
  "费兹班龙典": "ftd",
  "费兹班巨龙宝库": "ftd",
  sato23: "sato23",
  sato: "sato23",
  "sigil and the outlands": "sato23",
  mpp23: "mpp23",
  mpp: "mpp23",
  "morte's planar parade": "mpp23",
  "morte’s planar parade": "mpp23",
  aag22: "aag22",
  aag: "aag22",
  "astral adventurer's guide": "aag22",
  "astral adventurer’s guide": "aag22",
  bam22: "bam22",
  bam: "bam22",
  "boo's astral menagerie": "bam22",
  "boo’s astral menagerie": "bam22",
  userstats: "userstats",
  "user statblocks": "userstats",
  "user-provided statblocks": "userstats",
  "user provided statblocks": "userstats",
  "用户提供怪物卡": "userstats",
  "用户怪物卡": "userstats",
  mm: "mm14",
  mm14: "mm14",
  "monster manual": "mm14",
  mm24: "mm24",
  "monster manual 2024": "mm24",
  "2024 monster manual": "mm24",
  xge: "xge",
  xanathar: "xge",
  "xanathar's": "xge",
  tce: "tce",
  tasha: "tce",
  "tasha's": "tce",
  motm: "motm",
  "monsters of the multiverse": "motm",
  mtf: "mtf",
  mtof: "mtf",
  "mordenkainen's tome of foes": "mtf",
  "mordenkainen’s tome of foes": "mtf",
  "tome of foes": "mtf",
  coa: "coa",
  "chains of asmodeus": "coa",
  "asmodeus chains": "coa",
  "chains": "coa",
  "阿斯摩蒂斯的锁链": "coa",
  "阿斯摩蒂斯之锁": "coa",
  "阿斯莫蒂斯之链": "coa",
  wdmm: "wdmm",
  "waterdeep dungeon of the mad mage": "wdmm",
  "waterdeep: dungeon of the mad mage": "wdmm",
  "dungeon of the mad mage": "wdmm",
  "mad mage": "wdmm",
  undermountain: "wdmm",
  "疯法师地下城": "wdmm",
  "疯法师的地下城": "wdmm",
  "地下山城": "wdmm",
  "山地迷城": "wdmm",
  scag: "scag",
  "sword coast": "scag",
  vgm: "vgm",
  volo: "vgm",
  "volo's": "vgm"
};

const TYPE_BOOKS = {
  spell: ["frhof", "ftd", "phb14", "xge", "tce", "scag", "phb24"],
  monster: ["userstats", "coa", "wdmm", "ftd", "mm14", "motm", "mtf", "vgm", "mm24"],
  item: ["ftd", "dmg14", "xge", "tce", "phb14", "phb24", "dmg24"],
  rule: ["phb14", "dmg14", "xge", "tce", "scag", "ftd", "phb24", "dmg24"],
  all: null
};

const EXPLICIT_ONLY_BOOKS = new Set(["sato23", "mpp23", "aag22", "bam22"]);

const CLASS_ALIASES = {
  artificer: "Artificer",
  artificers: "Artificer",
  "奇械师": "Artificer",
  barbarian: "Barbarian",
  barbarians: "Barbarian",
  "野蛮人": "Barbarian",
  bard: "Bard",
  bards: "Bard",
  "吟游诗人": "Bard",
  cleric: "Cleric",
  clerics: "Cleric",
  "牧师": "Cleric",
  druid: "Druid",
  druids: "Druid",
  "德鲁伊": "Druid",
  fighter: "Fighter",
  fighters: "Fighter",
  "战士": "Fighter",
  monk: "Monk",
  monks: "Monk",
  "武僧": "Monk",
  paladin: "Paladin",
  paladins: "Paladin",
  "圣武士": "Paladin",
  ranger: "Ranger",
  rangers: "Ranger",
  "游侠": "Ranger",
  rogue: "Rogue",
  rogues: "Rogue",
  "游荡者": "Rogue",
  sorcerer: "Sorcerer",
  sorcerers: "Sorcerer",
  "术士": "Sorcerer",
  warlock: "Warlock",
  warlocks: "Warlock",
  "邪术士": "Warlock",
  "邪术师": "Warlock",
  wizard: "Wizard",
  wizards: "Wizard",
  "法师": "Wizard"
};

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeBookCode(value, lib = null) {
  if (!value) return null;
  const key = String(value).trim().toLowerCase();
  const books = lib?.books;
  if (books?.has(key)) return key;
  if (["phb", "player's handbook", "players"].includes(key)) {
    if (books?.has("phb14")) return "phb14";
    if (books?.has("phb24")) return "phb24";
  }
  if (["dmg", "dungeon master's guide"].includes(key)) {
    if (books?.has("dmg14")) return "dmg14";
    if (books?.has("dmg24")) return "dmg24";
  }
  if (["mm", "monster manual"].includes(key)) {
    if (books?.has("mm14")) return "mm14";
    if (books?.has("mm24")) return "mm24";
  }
  return BOOK_ALIASES[key] || key;
}

function parseBookList(value, lib = null) {
  if (!value) return null;
  if (!Array.isArray(value)) {
    const raw = String(value).trim();
    const direct = normalizeBookCode(raw, lib);
    if (direct && lib?.books?.has(direct)) return [direct];
  }
  const arr = Array.isArray(value) ? value : String(value).split(/[,\s]+/);
  const codes = arr.map(v => normalizeBookCode(v, lib)).filter(Boolean);
  return codes.length ? [...new Set(codes)] : null;
}

function requireRoot() {
  const root = process.env.CORE_RULES_PATH;
  if (!root) {
    throw new Error("CORE_RULES_PATH is not set");
  }
  const resolved = path.resolve(root);
  if (!fs.existsSync(path.join(resolved, "extraction_manifest.json"))) {
    throw new Error(`CORE_RULES_PATH does not contain extraction_manifest.json: ${resolved}`);
  }
  return resolved;
}

function readJson(root, rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
}

function readOptionalJson(root, rel) {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) ? JSON.parse(fs.readFileSync(abs, "utf8")) : null;
}

function countLines(abs) {
  return fs.readFileSync(abs, "utf8").split(/\r?\n/).length;
}

function addOptionalSiblingBook(books, spec) {
  if (!fs.existsSync(spec.abs) || !fs.statSync(spec.abs).isFile()) return;
  books.set(spec.code, {
    code: spec.code,
    short: spec.short,
    title: spec.title,
    kind: spec.kind,
    priority: spec.priority,
    full_source_file: path.basename(spec.abs),
    full_source_lines: countLines(spec.abs),
    abs: spec.abs,
    virtual: true
  });
}

function addOptionalSiblingSources(root, books) {
  const userStatsAbs = path.resolve(root, "../user_provided_statblocks/user_statblocks_full.md");
  addOptionalSiblingBook(books, {
    code: "userstats",
    short: "UserStats",
    title: "User-Provided Stat Blocks",
    kind: "user-provided monster reference cache",
    priority: "exact installed user-provided entries; preserve each entry's provenance and verification warning",
    abs: userStatsAbs
  });
  const coaAbs = path.resolve(root, "../official_5e_coa/coa_bestiary_full.md");
  addOptionalSiblingBook(books, {
    code: "coa",
    short: "CoA",
    title: "Chains of Asmodeus Bestiary",
    kind: "official module bestiary",
    priority: "module-specific monster stat blocks; preferred for CoA/Nine Hells creatures when present",
    abs: coaAbs
  });
  const frhofAbs = path.resolve(root, "../official_2025_faerun/frhof_spells_full.md");
  addOptionalSiblingBook(books, {
    code: "frhof",
    short: "FRHoF",
    title: "Forgotten Realms: Heroes of Faerun Spells",
    kind: "official setting spell cache",
    priority: "FRHoF spell text; preferred for adopted FRHoF spells when present",
    abs: frhofAbs
  });
  const wdmmAbs = path.resolve(root, "../official_5e_wdmm/wdmm_bestiary_full.md");
  addOptionalSiblingBook(books, {
    code: "wdmm",
    short: "WDMM",
    title: "Waterdeep: Dungeon of the Mad Mage Bestiary",
    kind: "official module bestiary",
    priority: "module-specific/reprinted monster stat blocks; preferred for WDMM/Undermountain creatures when present",
    abs: wdmmAbs
  });
  const ftdAbs = path.resolve(root, "../official_5e_fizban_dragons/ftd_mechanics_full.md");
  addOptionalSiblingBook(books, {
    code: "ftd",
    short: "FTD",
    title: "Fizban's Treasury of Dragons Complete Mechanics",
    kind: "official sourcebook mechanics cache",
    priority: "FTD monsters/mythic phases, spells, items, options, gifts, and lair/hoard mechanics",
    abs: ftdAbs
  });
  const satoAbs = path.resolve(root, "../official_5e_planescape/_full_source_sigil_and_outlands.md");
  addOptionalSiblingBook(books, {
    code: "sato23",
    short: "SATO23",
    title: "Sigil and the Outlands",
    kind: "official 2014-rules setting sourcebook full-text cache",
    priority: "explicit Planescape character-option, spell, item, portal, faction, Sigil, and Outlands lookup",
    abs: satoAbs
  });
  const mppAbs = path.resolve(root, "../official_5e_planescape/_full_source_mortes_planar_parade.md");
  addOptionalSiblingBook(books, {
    code: "mpp23",
    short: "MPP23",
    title: "Morte's Planar Parade",
    kind: "official 2014-rules planar bestiary full-text cache",
    priority: "explicit Planescape monster, faction-agent, and planar-encounter lookup",
    abs: mppAbs
  });
  const aagAbs = path.resolve(root, "../official_5e_spelljammer/_full_source_astral_adventurers_guide.md");
  addOptionalSiblingBook(books, {
    code: "aag22",
    short: "AAG22",
    title: "Astral Adventurer's Guide",
    kind: "official 2014-rules Spelljammer sourcebook full-page OCR cache",
    priority: "explicit Spelljammer character-option, spelljamming, ship, ship-combat, and Rock of Bral lookup",
    abs: aagAbs
  });
  const bamAbs = path.resolve(root, "../official_5e_spelljammer/_full_source_boos_astral_menagerie.md");
  addOptionalSiblingBook(books, {
    code: "bam22",
    short: "BAM22",
    title: "Boo's Astral Menagerie",
    kind: "official 2014-rules Spelljammer bestiary full-page OCR cache",
    priority: "explicit Spelljammer monster and Astral encounter lookup",
    abs: bamAbs
  });
}

function addOptional2025RealmsSources(root, books) {
  const fraifFullAbs = path.resolve(root, "../official_2025_faerun/_full_source_fraif.md");
  addOptionalSiblingBook(books, {
    code: "fraif25",
    short: "FRAIF25",
    title: "Forgotten Realms: Adventures in Faerun",
    kind: "official 2025 setting/adventure full-text cache",
    priority: "explicit on-demand source verification; mechanics follow the campaign adoption policy",
    abs: fraifFullAbs
  });
  const frhofFullAbs = path.resolve(root, "../official_2025_faerun/_full_source_frhof.md");
  addOptionalSiblingBook(books, {
    code: "frhof25",
    short: "FRHoF25",
    title: "Forgotten Realms: Heroes of Faerun",
    kind: "official 2025 player/setting full-text cache",
    priority: "explicit on-demand source verification; mechanics follow the campaign adoption policy",
    abs: frhofFullAbs
  });
}

function loadLibrary() {
  const root = requireRoot();
  const manifest = readJson(root, "extraction_manifest.json");
  const pdfMap = readJson(root, "pdf_page_map.json");
  const catalog = readJson(root, "lookup_catalog.json");
  const aliases = readJson(root, "lookup_aliases.json");
  const spellAccess = readJson(root, "lookups/spell_access_catalog.json");
  const structuredRuleTables = readOptionalJson(root, "lookups/structured_rule_tables.json");
  const books = new Map();
  for (const b of manifest.books || []) {
    books.set(b.code, {
      ...b,
      abs: path.join(root, b.full_source_file)
    });
  }
  if (books.has("phb14")) addOptionalSiblingSources(root, books);
  if (books.has("phb24")) addOptional2025RealmsSources(root, books);
  const lookupsDir = path.join(root, "lookups");
  const lookupFiles = fs.existsSync(lookupsDir)
    ? fs.readdirSync(lookupsDir)
      .filter(name => name.endsWith(".md"))
      .sort()
      .map(name => safeRel({ root, books }, path.join("lookups", name)))
    : [];
  if (
    !spellAccess
    || typeof spellAccess !== "object"
    || Array.isArray(spellAccess)
    || spellAccess.schema_version !== 1
    || !spellAccess.entries
    || typeof spellAccess.entries !== "object"
    || Array.isArray(spellAccess.entries)
    || spellAccess.entry_count !== Object.keys(spellAccess.entries).length
  ) {
    throw new Error("Invalid spell-access catalog schema or entry count");
  }
  const expectedEdition = books.has("phb24") ? "2024" : books.has("phb14") ? "2014" : null;
  if (expectedEdition && spellAccess.edition !== expectedEdition) {
    throw new Error(
      `Spell-access catalog edition mismatch: expected ${expectedEdition}, found ${spellAccess.edition}`
    );
  }
  if (structuredRuleTables) {
    if (
      structuredRuleTables.schema_version !== 1
      || !structuredRuleTables.entries
      || Array.isArray(structuredRuleTables.entries)
      || structuredRuleTables.entry_count !== Object.keys(structuredRuleTables.entries).length
    ) {
      throw new Error("Invalid structured-rule-table catalog schema or entry count");
    }
    for (const [id, entry] of Object.entries(structuredRuleTables.entries)) {
      const source = entry?.source;
      if (
        !entry?.title
        || !Array.isArray(entry.aliases)
        || !entry.book
        || !Array.isArray(entry.columns)
        || entry.columns.length < 2
        || !Array.isArray(entry.rows)
        || !entry.rows.length
        || !source?.file
        || !Number.isInteger(source.line)
        || !Number.isInteger(source.pdf_page)
        || !source.verification
      ) {
        throw new Error(`Invalid structured rule table: ${id}`);
      }
      const book = books.get(entry.book);
      if (!book || book.full_source_file !== source.file || source.line > book.full_source_lines) {
        throw new Error(`Structured rule table source does not match installed book: ${id}`);
      }
      if (entry.rows.some(row => !Array.isArray(row) || row.length !== entry.columns.length)) {
        throw new Error(`Structured rule table row width mismatch: ${id}`);
      }
    }
  }
  return {
    root,
    manifest,
    pdfMap,
    catalog,
    aliases,
    spellAccess,
    structuredRuleTables,
    books,
    lookupFiles
  };
}

function safeRel(lib, rel) {
  const clean = String(rel || "").replace(/^\/+/, "");
  const rootAbs = path.resolve(lib.root);
  let abs = path.resolve(rootAbs, clean);
  const registered = candidate => [...lib.books.values()].some(
    book => path.resolve(book.abs) === candidate
  );
  if (!abs.startsWith(rootAbs + path.sep) && !registered(abs)) {
    throw new Error(`Path escapes core rules root: ${rel}`);
  }
  if (!fs.existsSync(abs)) {
    const book = [...lib.books.values()].find(book => book.full_source_file === clean);
    if (book) abs = path.resolve(book.abs);
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new Error(`File not found: ${rel}`);
  }
  const rootReal = fs.realpathSync(rootAbs);
  const absReal = fs.realpathSync(abs);
  // Registration authorizes this exact logical source path, never another
  // alias to the same target. Manifests and installed sibling sources are
  // trusted local configuration; ordinary links must remain inside the root.
  if (!absReal.startsWith(rootReal + path.sep) && !registered(abs)) {
    throw new Error(`Path escapes core rules root via symlink: ${rel}`);
  }
  // Keep the registered logical path for source/page-map and reflow identity.
  return abs;
}

function codeForFile(lib, file) {
  const base = path.basename(file);
  for (const [code, b] of lib.books.entries()) {
    if (b.full_source_file === base) return code;
  }
  return null;
}

function isReflowEligible(lib, file) {
  const resolved = path.resolve(file);
  return [...lib.books.values()].some(book => (
    path.resolve(book.abs) === resolved
    && /^_full_source.*\.md$/i.test(path.basename(book.full_source_file || book.abs))
  ));
}

function pageForLine(lib, code, line) {
  const pages = lib.pdfMap?.[code]?.pages || [];
  let lo = 0, hi = pages.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const p = pages[mid];
    if (line < p.line_start) hi = mid - 1;
    else if (line > p.line_end) lo = mid + 1;
    else return p.pdf_page;
  }
  return null;
}

function readWindow(abs, centerLine, context) {
  const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
  const line = clampInt(centerLine, 1, 1, Math.max(1, lines.length));
  const ctx = clampInt(context, DEFAULT_CONTEXT, 0, MAX_CONTEXT);
  const start = Math.max(1, line - ctx);
  const end = Math.min(lines.length, line + ctx);
  const out = [];
  for (let i = start; i <= end; i++) {
    out.push(`${String(i).padStart(6, " ")} | ${lines[i - 1]}`);
  }
  return { start, end, text: out.join("\n") };
}

function readingOrderLabel(mode, pageNumber) {
  if (mode === "columns") {
    return `reading_order: reconstructed${pageNumber ? ` (PDF page ${pageNumber})` : ""}`;
  }
  if (mode === "fallback") {
    return `reading_order: source-order fallback${pageNumber ? ` (PDF page ${pageNumber})` : ""}`;
  }
  return null;
}

function pageEntrySelector(lines, sourceLine, matcher) {
  const view = pageViewForLine(lines, sourceLine);
  if (view.mode !== "columns") return null;
  const matches = view.entries.filter(entry => (
    entry.sourceLine === sourceLine && matcher(entry.text)
  ));
  return matches.length === 1 ? { column: matches[0].column } : null;
}

function querySelector(lines, sourceLine, query, regex = false) {
  if (!query) return null;
  let matcher;
  if (regex) {
    try {
      const pattern = new RegExp(query, "i");
      matcher = text => pattern.test(text);
    } catch {
      return null;
    }
  } else {
    const needle = String(query).toLocaleLowerCase();
    matcher = text => text.toLocaleLowerCase().includes(needle);
  }
  return pageEntrySelector(lines, sourceLine, matcher);
}

function headingSelector(lines, sourceLine, names) {
  const variants = Array.isArray(names) ? names : [names];
  return pageEntrySelector(lines, sourceLine, text => (
    variants.some(name => headingSegmentScore(text, name) > 0)
  ));
}

function entitySelector(lines, sourceLine, name) {
  return headingSelector(lines, sourceLine, name);
}

function readOrderedWindow(lib, abs, centerLine, context, options = {}) {
  const source = readWindow(abs, centerLine, context);
  if (options.readingOrder === "source" || !isReflowEligible(lib, abs)) {
    return { ...source, mode: "source", pageNumber: null, label: null };
  }

  const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
  const view = pageViewForLine(lines, centerLine);
  if (view.pageNumber === null) {
    return { ...source, mode: "source", pageNumber: null, label: null };
  }
  if (view.mode !== "columns") {
    return {
      ...source,
      mode: "fallback",
      pageNumber: view.pageNumber,
      label: readingOrderLabel("fallback", view.pageNumber)
    };
  }

  const selector = options.selector
    || querySelector(lines, centerLine, options.query, options.regex);
  try {
    const logical = logicalWindowForLine(lines, centerLine, context, selector || undefined);
    if (!logical.text) throw new RangeError("logical target not found");
    return {
      ...logical,
      mode: "columns",
      label: readingOrderLabel("columns", logical.pageNumber)
    };
  } catch (error) {
    if (!(error instanceof RangeError) && !(error instanceof TypeError)) throw error;
    return {
      ...source,
      mode: "fallback",
      pageNumber: view.pageNumber,
      label: readingOrderLabel("fallback", view.pageNumber)
    };
  }
}

function formatResultSection(header, window) {
  const label = window.label ? `\n${window.label}` : "";
  return `${header}${label}\n\n\`\`\`text\n${window.text}\n\`\`\``;
}

function readBodyWindow(abs, startLine, maxLines) {
  const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
  const start = clampInt(startLine, 1, 1, Math.max(1, lines.length));
  const limit = clampInt(maxLines, DEFAULT_LOOKUP_CONTEXT, 1, MAX_BODY_LINES);
  const startHeading = lines[start - 1].match(/^\s*(#{1,6})\s+\S/);
  const startLevel = startHeading ? startHeading[1].length : null;
  const out = [];
  for (let i = start; i <= lines.length && out.length < limit; i++) {
    if (i > start) {
      const heading = lines[i - 1].match(/^\s*(#{1,6})\s+\S/);
      if (heading && (startLevel === null || heading[1].length <= startLevel)) break;
    }
    out.push(`${String(i).padStart(6, " ")} | ${lines[i - 1]}`);
  }
  return { start, end: start + out.length - 1, text: out.join("\n") };
}

function truncate(text, maxChars = MAX_CHARS) {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + `\n\n[truncated: ${text.length - maxChars} more characters omitted; narrow the query or open a specific line]`;
}

function selectedFiles(lib, books, type = "all") {
  let codes = parseBookList(books, lib);
  if (!codes) {
    codes = TYPE_BOOKS[type]
      || [...lib.books.keys()].filter((code) => !EXPLICIT_ONLY_BOOKS.has(code));
  }
  const files = [];
  const missing = [];
  for (const code of codes) {
    const b = lib.books.get(code);
    if (b) files.push(b.abs);
    else missing.push(code);
  }
  if (books && missing.length) {
    throw new Error(`Book code(s) not installed in this rules library: ${missing.join(", ")}. Installed: ${[...lib.books.keys()].join(", ")}`);
  }
  return files.length ? files : [...lib.books.values()].map(b => b.abs);
}

function searchableFiles(lib, options = {}) {
  const files = selectedFiles(lib, options.books, options.type || "all");
  if (
    options.books
    || !options.includeLookups
    || !["all", "rule"].includes(options.type || "all")
  ) {
    return files;
  }
  return [...lib.lookupFiles, ...files];
}

function rgSearch(lib, query, options = {}) {
  const maxResults = clampInt(options.maxResults, DEFAULT_MAX_RESULTS, 1, MAX_RESULTS);
  const regex = Boolean(options.regex);
  const files = searchableFiles(lib, options);
  const args = ["--line-number", "--with-filename", "--ignore-case", "--no-heading"];
  if (!regex) args.push("--fixed-strings");
  args.push("--", query, ...files);
  const result = spawnSync("rg", args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 8 });
  if (result.error && result.error.code === "ENOENT") {
    return jsSearch(lib, query, options);
  }
  if (result.error || result.signal || ![0, 1].includes(result.status)) {
    const failure = result.error
      ? `${result.error.code || "execution error"}: ${result.error.message}`
      : result.signal ? `signal ${result.signal}` : `exit ${result.status}`;
    const detail = (result.stderr || "").trim().slice(0, 2000);
    throw new Error(`rg search failed (${failure})${detail ? `: ${detail}` : ""}`);
  }
  if (result.status === 1) return [];
  const hits = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(/^(.*?):(\d+):(.*)$/);
    if (!m) continue;
    const abs = m[1];
    const lineNo = Number.parseInt(m[2], 10);
    const code = codeForFile(lib, abs);
    const rel = path.relative(lib.root, abs);
    hits.push({
      code,
      book: code ? lib.books.get(code)?.short : null,
      file: rel,
      line: lineNo,
      pdf_page: code ? pageForLine(lib, code, lineNo) : null,
      match: m[3].trim()
    });
    if (hits.length >= maxResults) break;
  }
  return hits;
}

function jsSearch(lib, query, options = {}) {
  const maxResults = clampInt(options.maxResults, DEFAULT_MAX_RESULTS, 1, MAX_RESULTS);
  const regex = Boolean(options.regex);
  const pattern = regex ? new RegExp(query, "i") : null;
  const q = String(query).toLowerCase();
  const hits = [];
  for (const abs of searchableFiles(lib, options)) {
    const code = codeForFile(lib, abs);
    const rel = path.relative(lib.root, abs);
    const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const ok = regex ? pattern.test(lines[i]) : lines[i].toLowerCase().includes(q);
      if (!ok) continue;
      hits.push({
        code,
        book: code ? lib.books.get(code)?.short : null,
        file: rel,
        line: i + 1,
        pdf_page: code ? pageForLine(lib, code, i + 1) : null,
        match: lines[i].trim()
      });
      if (hits.length >= maxResults) return hits;
    }
  }
  return hits;
}

function formatSearch(lib, hits, contextLines, options = {}) {
  if (!hits.length) return "No local match. Try aliases/OCR variants or external verification.";
  const ctx = clampInt(contextLines, DEFAULT_CONTEXT, 0, MAX_CONTEXT);
  const parts = [];
  for (const h of hits) {
    const abs = path.join(lib.root, h.file);
    const win = h.orderedWindow || readOrderedWindow(lib, abs, h.line, ctx, {
      readingOrder: options.readingOrder || "auto",
      query: options.query,
      regex: options.regex
    });
    const page = h.pdf_page ? `, pdf p.${h.pdf_page}` : "";
    parts.push(formatResultSection(
      `### ${h.book || h.code || "file"} ${h.file}:${h.line}${page}`,
      win
    ));
  }
  return truncate(parts.join("\n\n---\n\n"));
}

function formatBodySearch(lib, hits, bodyLines) {
  if (!hits.length) return "No local match. Try aliases/OCR variants or external verification.";
  const parts = [];
  for (const h of hits) {
    const abs = path.resolve(lib.root, h.file);
    const win = h.bodyWindow || readBodyWindow(abs, h.line, bodyLines);
    const page = h.pdf_page ? `, pdf p.${h.pdf_page}` : "";
    parts.push(formatResultSection(
      `### ${h.book || h.code || "file"} ${h.file}:${h.line}${page}`,
      win
    ));
  }
  return truncate(parts.join("\n\n---\n\n"));
}

function catalogHits(lib, name, category) {
  const n = String(name).trim().toLowerCase();
  return (lib.catalog || []).filter(e => {
    if (category && e.category !== category) return false;
    return String(e.name || "").trim().toLowerCase() === n;
  });
}

function ruleCatalogHits(lib, name) {
  const n = String(name).trim().toLowerCase();
  return (lib.catalog || []).filter(entry =>
    RULE_CATEGORIES.has(entry.category)
    && String(entry.name || "").trim().toLowerCase() === n
  );
}

function exactHeadingHits(lib, name, options = {}) {
  const title = String(name || "").trim().replace(/\s+/g, " ");
  if (!title) return [];
  return rgSearch(lib, `^\\s*(?:#{1,6}\\s+)?${escapeRegExp(title)}\\s*$`, {
    ...options,
    regex: true
  });
}

function flexibleTitleRegex(name) {
  const title = String(name || "").trim();
  if (!title) return "";
  let out = "";
  let lastWasSpace = false;
  for (const ch of title) {
    if (/\s/.test(ch)) {
      if (!lastWasSpace) out += "\\s+";
      lastWasSpace = true;
      continue;
    }
    lastWasSpace = false;
    if (/[A-Za-z0-9]/.test(ch)) {
      out += `${escapeRegExp(ch)}\\s*`;
    } else if (ch === "'" || ch === "’") {
      out += "['’]?\\s*";
    } else {
      out += `${escapeRegExp(ch)}\\s*`;
    }
  }
  return out;
}

function strictHeadingRegex(name) {
  const flex = flexibleTitleRegex(name);
  if (!flex) return "";
  return `(?:^\\s*(?:#{1,6}\\s+)?|\\s{2,})(?:\\d+\\.\\s*)?${flex}(?:\\s{2,}|\\s*[.:\\[(]|$)`;
}

function headingSegments(lineText) {
  const line = String(lineText || "")
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*[`:;.,_<>{}|/\\-]+\s*/, "")
    .replace(/^\s*\d+\.\s*/, "")
    .trim();
  if (!line) return [];
  return line.split(/\s{2,}|\t+/).map(part => part.trim()).filter(Boolean);
}

function levenshtein(a, b) {
  const left = String(a);
  const right = String(b);
  const row = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const saved = row[j];
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + cost);
      previous = saved;
    }
  }
  return row[right.length];
}

function headingSegmentScore(lineText, name) {
  const target = compactLetters(name);
  if (!target) return 0;
  const labeledStart = new RegExp(`^\\s*${flexibleTitleRegex(name)}(?:[.:\\[(]|$)`, "i");
  let best = 0;
  for (const segment of headingSegments(lineText)) {
    const candidate = compactLetters(segment);
    if (!candidate) continue;
    if (candidate === target) {
      best = Math.max(best, 100);
      continue;
    }
    if (labeledStart.test(segment)) {
      best = Math.max(best, 90);
      continue;
    }
    if (target.length < 8 || Math.abs(candidate.length - target.length) > 3) continue;
    const limit = Math.min(3, Math.max(1, Math.floor(target.length * 0.12)));
    const distance = levenshtein(candidate, target);
    if (distance <= limit) best = Math.max(best, 80 - distance);
  }
  return best;
}

function filePriority(lib, hit, books, type) {
  const ordered = selectedFiles(lib, books, type);
  const priorities = new Map(ordered.map((abs, index) => [path.resolve(abs), index]));
  return priorities.get(path.resolve(lib.root, hit.file)) ?? ordered.length;
}

function sortHits(lib, hits, books, type) {
  return [...hits].sort((a, b) => {
    const score = (b.score || 0) - (a.score || 0);
    if (score) return score;
    const priority = filePriority(lib, a, books, type) - filePriority(lib, b, books, type);
    if (priority) return priority;
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });
}

function strictHeadingHits(lib, name, options = {}) {
  const pattern = strictHeadingRegex(name);
  if (!pattern) return [];
  return rgSearch(lib, pattern, {
    ...options,
    regex: true,
    maxResults: MAX_RESULTS
  })
    .map(hit => ({ ...hit, score: headingSegmentScore(hit.match, name) }))
    .filter(hit => hit.score > 0);
}

function fuzzyHeadingHits(lib, name, options = {}) {
  const hits = [];
  for (const abs of selectedFiles(lib, options.books, options.type || "all")) {
    const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
    const code = codeForFile(lib, abs);
    for (let index = 0; index < lines.length; index++) {
      const score = headingSegmentScore(lines[index], name);
      if (score < 75) continue;
      hits.push({
        code,
        book: code ? lib.books.get(code)?.short : null,
        file: path.relative(lib.root, abs),
        line: index + 1,
        pdf_page: code ? pageForLine(lib, code, index + 1) : null,
        match: lines[index].trim(),
        score
      });
    }
  }
  return sortHits(lib, hits, options.books, options.type || "all");
}

function spellBodyScore(text) {
  const patterns = [
    /(?:\*{2}\bCasting\s*T\s*ime\*{2}\s*|\bCasting\s*T\s*ime\s*:)/i,
    /(?:\*{2}\bRange\*{2}\s*|\bRange\s*:)/i,
    /(?:\*{2}\bComponents\*{2}\s*|\bComponents\s*:)/i,
    /(?:\*{2}\bDuration\*{2}\s*|\bDuration\s*:)/i
  ];
  return patterns.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
}

function isSpellBodyText(text) {
  return spellBodyScore(text) >= 3;
}

function spellValidationText(abs, line) {
  const forward = readForward(abs, line, 12);
  if (isSpellBodyText(forward)) return forward;
  return readWindow(abs, line, 28).text;
}

function compactLetters(s) {
  return String(s || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function normalizedLookupKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function formatStructuredRuleTable(lib, entry) {
  const book = lib.books.get(entry.book);
  const source = entry.source;
  const rows = [
    `### ${book.short || entry.book} ${source.file}:${source.line}, pdf p.${source.pdf_page}`,
    "reading_order: curated structured table",
    `verification: ${source.verification}`,
    "projection: verified transcription; the cited book page remains authoritative",
    "",
    `| ${entry.columns.join(" | ")} |`,
    `| ${entry.columns.map(() => "---").join(" | ")} |`,
    ...entry.rows.map(row => `| ${row.join(" | ")} |`)
  ];
  return truncate(rows.join("\n"));
}

function lookupStructuredRuleTable(lib, topic, books) {
  const entries = Object.values(lib.structuredRuleTables?.entries || {});
  if (!entries.length) return null;
  const requestedCodes = parseBookList(books, lib);
  const requestedSet = requestedCodes ? new Set(requestedCodes) : null;
  const key = normalizedLookupKey(topic);
  for (const entry of entries) {
    if (requestedSet && !requestedSet.has(entry.book)) continue;
    const names = [entry.title, ...(entry.aliases || [])];
    if (names.some(name => normalizedLookupKey(name) === key)) {
      return formatStructuredRuleTable(lib, entry);
    }
  }
  return null;
}

function isLikelySpellHeadingLine(lineText, name) {
  return headingSegmentScore(lineText, name) > 0;
}

function sourceOrderSpellLane(lineText, name) {
  const segments = headingSegments(lineText);
  const matching = segments
    .map((segment, index) => ({ segment, index }))
    .filter(candidate => headingSegmentScore(candidate.segment, name) > 0);
  return matching.length === 1 ? matching[0].index : null;
}

function isSpellLevelDeclaration(text) {
  const value = String(text)
    .replace(/^\s*#{1,6}\s+/, "")
    .replaceAll("*", "")
    .trim();
  return /^(?:Level\s+\d+\b|(?:[A-Za-z]+\s+)?Cantrip\b|\d+(?:st|nd|rd|th)-level\b)/i.test(value);
}

function isCastingTimeDeclaration(text) {
  return /^Casting\s*T\s*ime\s*:/i.test(String(text).trim());
}

function sourceOrderHasImmediateSpellMetadata(lines, sourceLine, laneIndex) {
  const lane = lines
    .slice(sourceLine, sourceLine + 7)
    .map(line => headingSegments(line)[laneIndex] || "");
  const levelIndex = lane.findIndex(isSpellLevelDeclaration);
  return levelIndex >= 0
    && lane.slice(levelIndex + 1).some(isCastingTimeDeclaration);
}

function isPotentialAllCapsHeading(text) {
  const value = String(text || "").trim();
  if (!value || value.length > 90 || /[:.!?]/.test(value)) return false;
  if (/^(?:AT HIGHER LEVELS|PART\b|CHAPTER\b)/i.test(value)) return false;
  const letters = value.match(/[A-Za-z]/g) || [];
  const uppercase = value.match(/[A-Z]/g) || [];
  return letters.length >= 3 && uppercase.length / letters.length >= 0.7;
}

function nextSpellHeadingIndex(entries, startIndex) {
  for (let index = startIndex + 1; index < entries.length; index += 1) {
    if (!isPotentialAllCapsHeading(entries[index].text)) continue;
    const lookahead = entries.slice(index + 1, index + 7);
    const levelIndex = lookahead.findIndex(entry => isSpellLevelDeclaration(entry.text));
    if (levelIndex < 0) continue;
    if (!lookahead.slice(levelIndex + 1).some(entry => isCastingTimeDeclaration(entry.text))) {
      continue;
    }
    return index;
  }
  return entries.length;
}

function isSpellPageNoise(text) {
  return /^(?:PART|CHAPTER)\b.*\bS\s*P\s*E\s*L\s*L/i.test(String(text).trim());
}

function reconstructedSpellWindow(lib, abs, sourceLine, name) {
  if (!isReflowEligible(lib, abs)) return null;
  const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
  const view = pageViewForLine(lines, sourceLine);
  if (view.mode !== "columns") return null;
  const selector = entitySelector(lines, sourceLine, name);
  if (!selector) return null;
  const startIndex = view.entries.findIndex(entry => (
    entry.sourceLine === sourceLine && entry.column === selector.column
  ));
  if (startIndex < 0) return null;
  const endIndex = nextSpellHeadingIndex(view.entries, startIndex);
  const entries = view.entries
    .slice(startIndex, Math.min(endIndex, startIndex + MAX_BODY_LINES))
    .filter(entry => !isSpellPageNoise(entry.text));
  if (!entries.length) return null;
  return {
    start: entries[0].sourceLine,
    end: entries.at(-1).sourceLine,
    pageNumber: view.pageNumber,
    mode: "columns",
    label: readingOrderLabel("columns", view.pageNumber),
    text: formatPageEntries(entries),
    validationText: entries.map(entry => entry.text).join("\n")
  };
}

function spellCandidateBody(lib, abs, hit, name) {
  const reconstructed = reconstructedSpellWindow(lib, abs, hit.line, name);
  if (reconstructed) return reconstructed;

  if (!isReflowEligible(lib, abs)) {
    return {
      mode: "source",
      validationText: spellValidationText(abs, hit.line)
    };
  }

  const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
  const view = pageViewForLine(lines, hit.line);
  const lineText = lines[hit.line - 1] || "";
  if (view.pageNumber !== null) {
    const laneIndex = sourceOrderSpellLane(lineText, name);
    if (laneIndex === null) return null;
    if (!sourceOrderHasImmediateSpellMetadata(lines, hit.line, laneIndex)) return null;
  }
  return {
    mode: "source",
    validationText: spellValidationText(abs, hit.line)
  };
}

function formatSpellSearch(lib, hits, contextLines) {
  const parts = [];
  for (const hit of hits) {
    const abs = path.resolve(lib.root, hit.file);
    const page = hit.pdf_page ? `, pdf p.${hit.pdf_page}` : "";
    const header = `### ${hit.book || hit.code || "file"} ${hit.file}:${hit.line}${page}`;
    const win = hit.spellWindow?.mode === "columns"
      ? hit.spellWindow
      : readOrderedWindow(lib, abs, hit.line, contextLines, { readingOrder: "auto" });
    parts.push(formatResultSection(header, win));
  }
  return truncate(parts.join("\n\n---\n\n"));
}

function uniqueHits(hits) {
  const seen = new Set();
  const out = [];
  for (const h of hits) {
    const key = `${h.file}:${h.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

function knownVariants(lib, name) {
  const input = String(name).trim();
  const normalizedInput = compactLetters(input);
  const variants = [];
  const kv = lib.aliases?.known_variants || {};
  for (const [key, arr] of Object.entries(kv)) {
    const names = [key, ...(Array.isArray(arr) ? arr : [])];
    if (names.some(value => compactLetters(value) === normalizedInput)) {
      variants.push(...names);
    }
  }
  variants.push(input);
  return [...new Set(variants.filter(Boolean))];
}

const TOPIC_STOP_WORDS = new Set([
  "a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or",
  "the", "to", "with"
]);

const TOPIC_TERM_NORMALIZATION = new Map([
  ["deities", "deity"],
  ["dwarves", "dwarf"],
  ["elves", "elf"],
  ["halves", "half"],
  ["societies", "society"]
]);

function topicTerms(text) {
  const words = String(text || "")
    .normalize("NFKD")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) || [];
  return [...new Set(words
    .map(word => TOPIC_TERM_NORMALIZATION.get(word) || word)
    .filter(word => word.length >= 3 && !TOPIC_STOP_WORDS.has(word)))];
}

function topicTermOverlap(left, right) {
  const rightSet = new Set(right);
  return left.reduce((count, term) => count + (rightSet.has(term) ? 1 : 0), 0);
}

function isLikelyTopicHeading(segment) {
  const text = String(segment || "").trim();
  if (!text || text.length > 140) return false;
  if (/^#{1,6}\s+\S/.test(text)) return true;
  const letters = text.match(/[A-Za-z]/g) || [];
  if (letters.length < 3) return false;
  const uppercase = text.match(/[A-Z]/g) || [];
  return uppercase.length / letters.length >= 0.72;
}

function topicFallbackHits(lib, topic, books, maxResults) {
  const terms = topicTerms(topic);
  if (terms.length < 2) return [];
  const requestedCodes = parseBookList(books, lib);
  if (books) selectedFiles(lib, books, "rule");
  const requestedSet = requestedCodes ? new Set(requestedCodes) : null;
  const candidates = [];

  for (const entry of lib.catalog || []) {
    if (!RULE_CATEGORIES.has(entry.category)) continue;
    const overlap = topicTermOverlap(topicTerms(entry.name), terms);
    if (!overlap) continue;
    for (const book of entry.books || []) {
      if (requestedSet && !requestedSet.has(book.code)) continue;
      const installed = lib.books.get(book.code);
      if (!installed) continue;
      const lines = fs.readFileSync(installed.abs, "utf8").split(/\r?\n/);
      for (const hit of book.hits || []) {
        const window = lines.slice(Math.max(0, hit.line - 1), hit.line - 1 + 140).join("\n");
        if (topicTermOverlap(topicTerms(window), terms) !== terms.length) continue;
        candidates.push({
          code: book.code,
          book: book.short || installed.short,
          file: path.relative(lib.root, installed.abs),
          line: hit.line,
          pdf_page: hit.pdf_page || pageForLine(lib, book.code, hit.line),
          match: hit.pattern || entry.name,
          score: 500 + overlap * 100
        });
      }
    }
  }

  for (const abs of selectedFiles(lib, books, "rule")) {
    const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
    const code = codeForFile(lib, abs);
    for (let index = 0; index < lines.length; index++) {
      let bestOverlap = 0;
      for (const segment of headingSegments(lines[index])) {
        if (!isLikelyTopicHeading(segment)) continue;
        bestOverlap = Math.max(bestOverlap, topicTermOverlap(topicTerms(segment), terms));
      }
      if (!bestOverlap) continue;
      const window = lines.slice(index, index + 100).join("\n");
      if (topicTermOverlap(topicTerms(window), terms) !== terms.length) continue;
      candidates.push({
        code,
        book: code ? lib.books.get(code)?.short : null,
        file: path.relative(lib.root, abs),
        line: index + 1,
        pdf_page: code ? pageForLine(lib, code, index + 1) : null,
        match: lines[index].trim(),
        score: bestOverlap * 100
      });
    }
  }

  return sortHits(lib, uniqueHits(candidates), books, "rule").slice(0, maxResults);
}

function srdFile(lib, type) {
  const is2014 = lib.books.has("phb14");
  const is2024 = lib.books.has("phb24");
  const rel = is2014
    ? {
      spell: "../_srd_5e/spells.md",
      monster: "../_srd_5e/monsters.md",
      item: "../_srd_5e/magic_items.md"
    }[type]
    : is2024
      ? {
        spell: "../_srd_5e_2024/spells.md",
        monster: "../_srd_5e_2024/monsters_a_z.md",
        item: "../_srd_5e_2024/magic_items.md",
        rule: "../_srd_5e_2024/rules_glossary.md"
      }[type]
      : null;
  return rel ? path.resolve(lib.root, rel) : null;
}

function srdHeadingHits(lib, name, type, maxResults) {
  const srdAbs = srdFile(lib, type);
  if (!fs.existsSync(srdAbs) || !fs.statSync(srdAbs).isFile()) return [];
  const title = String(name || "").trim().replace(/\s+/g, " ");
  const rel = path.relative(lib.root, srdAbs);
  const lines = fs.readFileSync(srdAbs, "utf8").split(/\r?\n/);
  const re = new RegExp(`^\\s*#{1,6}\\s+${escapeRegExp(title)}\\s*$`, "i");
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue;
    hits.push({
      code: lib.books.has("phb24") ? "srd5e24" : "srd5e",
      book: lib.books.has("phb24") ? "SRD5E24" : "SRD5E",
      file: rel,
      line: i + 1,
      pdf_page: null,
      match: lines[i].trim()
    });
    if (hits.length >= maxResults) break;
  }
  return hits;
}

function lookupSpellEntity(lib, name, books, maxResults, contextLines) {
  const requestedCodes = parseBookList(books, lib);
  if (books) selectedFiles(lib, books, "spell");
  const requestedSet = requestedCodes ? new Set(requestedCodes) : null;
  const candidates = [];
  const entries = catalogHits(lib, name, "spell");
  for (const entry of entries) {
    for (const book of entry.books || []) {
      if (requestedSet && !requestedSet.has(book.code)) continue;
      const b = lib.books.get(book.code);
      if (!b) continue;
      for (const hit of book.hits || []) {
        candidates.push({
          code: book.code,
          book: book.short || b.short,
          file: path.relative(lib.root, b.abs),
          line: hit.line,
          pdf_page: hit.pdf_page || pageForLine(lib, book.code, hit.line),
          match: hit.pattern || entry.name
        });
      }
    }
  }
  for (const v of knownVariants(lib, name)) {
    candidates.push(...strictHeadingHits(lib, v, { books, type: "spell" }));
  }
  const valid = [];
  const ordered = sortHits(lib, uniqueHits(candidates), books, "spell");
  for (const hit of ordered) {
    const abs = path.resolve(lib.root, hit.file);
    if (!fs.existsSync(abs)) continue;
    const lineText = fs.readFileSync(abs, "utf8").split(/\r?\n/)[hit.line - 1] || "";
    if (!isLikelySpellHeadingLine(lineText, name)) continue;
    const spellWindow = spellCandidateBody(lib, abs, hit, name);
    if (!spellWindow || !isSpellBodyText(spellWindow.validationText)) continue;
    valid.push({ ...hit, spellWindow });
    if (valid.length >= maxResults) break;
  }
  const spellOutputContext = Math.max(contextLines, 28);
  if (valid.length) return formatSpellBodyOutput(formatSpellSearch(lib, valid, spellOutputContext));

  for (const v of knownVariants(lib, name)) {
    for (const hit of fuzzyHeadingHits(lib, v, { books, type: "spell" })) {
      const abs = path.resolve(lib.root, hit.file);
      const spellWindow = spellCandidateBody(lib, abs, hit, name);
      if (!spellWindow || !isSpellBodyText(spellWindow.validationText)) continue;
      valid.push({ ...hit, spellWindow });
      if (valid.length >= maxResults) break;
    }
    if (valid.length) break;
  }
  if (valid.length) return formatSpellBodyOutput(formatSpellSearch(lib, valid, spellOutputContext));

  const primaryPhb = lib.books.has("phb24") ? "phb24" : "phb14";
  const allowSrdFallback = !requestedSet || requestedSet.has(primaryPhb);
  if (allowSrdFallback) {
    const srdValid = [];
    for (const hit of srdHeadingHits(lib, name, "spell", maxResults)) {
      const abs = path.resolve(lib.root, hit.file);
      const lineText = fs.readFileSync(abs, "utf8").split(/\r?\n/)[hit.line - 1] || "";
      if (!isLikelySpellHeadingLine(lineText, name)) continue;
      const spellWindow = spellCandidateBody(lib, abs, hit, name);
      if (!spellWindow || !isSpellBodyText(spellWindow.validationText)) continue;
      srdValid.push({ ...hit, spellWindow });
      if (srdValid.length >= maxResults) break;
    }
    if (srdValid.length) {
      return formatSpellBodyOutput(formatSpellSearch(lib, srdValid, spellOutputContext));
    }
  }

  return "No local spell-body match. List/table hits were ignored; try a source-specific lookup card, OCR-flexible spelling, or external verification.";
}

function formatSpellBodyOutput(body) {
  return [
    "CAUTION: Spell-body text only. Confident two-column PDF pages use a reconstructed reading view; use open_core_rules with reading_order=source for physical-row inspection.",
    "This output does not establish class, subclass, or feature access; use lookup_spell_access for that question.",
    "",
    body
  ].join("\n");
}

function normalizeAccessName(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[’‘]/g, "'")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeClassName(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return CLASS_ALIASES[raw.toLowerCase()] || raw;
}

function spellAccessClassNames(lib) {
  const names = new Map();
  for (const entry of Object.values(lib.spellAccess?.entries || {})) {
    for (const field of ["base_classes", "optional_class_lists", "conditional_access"]) {
      for (const record of entry[field] || []) {
        if (!record.class_name) continue;
        names.set(normalizeAccessName(record.class_name), record.class_name);
      }
    }
  }
  return names;
}

function spellAccessEntry(lib, name) {
  if (!lib.spellAccess) return null;
  const keys = [name, ...knownVariants(lib, name)].map(normalizeAccessName);
  for (const key of [...new Set(keys)]) {
    const entry = lib.spellAccess.entries[key];
    if (entry) return entry;
  }
  return null;
}

function accessClassMatches(record, className) {
  return normalizeAccessName(record.class_name) === normalizeAccessName(className);
}

function accessRecordLabel(record) {
  const typeLabels = {
    subclass: "subclass",
    optional_feature: "optional feature",
    feat: "feat",
    race: "species/race",
    background: "background",
    reward: "reward"
  };
  const type = typeLabels[record.access_type] || record.access_type;
  const mode = String(record.mode || "conditional_feature").replaceAll("_", " ");
  const parts = [type, mode];
  if (record.minimum_class_level) {
    parts.push(`${record.class_name || "class"} level ${record.minimum_class_level}`);
  }
  if (record.sub_options?.length) parts.push(record.sub_options.join(", "));
  return parts.join("; ");
}

function formatAccessRecord(record) {
  const confidence = record.semantics === "audited" ? "audited" : "discovery-only";
  return [
    `- **${record.feature_name}** [${confidence}; ${accessRecordLabel(record)}]`,
    `  ${record.detail}`,
    `  Source: ${record.source_ref}`
  ].join("\n");
}

function lookupSpellAccess(lib, name, classNameInput = null) {
  if (!lib.spellAccess) {
    return [
      "Spell-access catalog unavailable for this rules library.",
      "Do not infer class access from OCR spell-list rows or from lookup_spell.",
      "Use the source feature text or rebuild lookups/spell_access_catalog.json."
    ].join("\n");
  }
  const entry = spellAccessEntry(lib, name);
  if (!entry) {
    return [
      `No structured spell-access record for "${name}" in the ${lib.spellAccess.edition} catalog.`,
      "This is not proof that the spell or an access feature is absent.",
      "Do not infer access from OCR; verify the exact class/subclass/feature source."
    ].join("\n");
  }

  const normalizedClassInput = normalizeClassName(classNameInput);
  const knownClasses = spellAccessClassNames(lib);
  const className = normalizedClassInput
    ? knownClasses.get(normalizeAccessName(normalizedClassInput))
    : null;
  if (classNameInput && !className) {
    return [
      `Unknown class filter "${classNameInput}" for the ${lib.spellAccess.edition} spell-access catalog.`,
      "No base-list verdict was produced.",
      `Known classes: ${[...knownClasses.values()].sort().join(", ")}.`,
      "Correct the class name or omit class_name to inspect all recorded paths."
    ].join("\n");
  }
  const baseClasses = entry.base_classes || [];
  const optionalLists = entry.optional_class_lists || [];
  const conditional = entry.conditional_access || [];
  const spellSources = (entry.spell_sources || [])
    .map(source => `${source.source}${source.page ? ` p.${source.page}` : ""}`)
    .join(", ");
  const lines = [
    `# Spell Access: ${entry.name}`,
    "",
    `Edition: ${lib.spellAccess.edition}`,
    `Spell level: ${entry.level === 0 ? "cantrip" : entry.level}`,
    `Spell source: ${spellSources || "not recorded"}`,
    `Catalog provenance: ${lib.spellAccess.provenance?.source || "structured access catalog"} @ ${lib.spellAccess.provenance?.upstream_revision || "unknown revision"}`,
    "",
    "A spell-body hit does not prove class access. The verdict below comes only from the structured access catalog."
  ];

  if (className) {
    const baseMatches = baseClasses.filter(record => accessClassMatches(record, className));
    const variantMatches = optionalLists.filter(record => accessClassMatches(record, className));
    const classConditional = conditional.filter(record => accessClassMatches(record, className));
    lines.push(
      "",
      `## ${className}`,
      "",
      `Base-list verdict: ${baseMatches.length ? "YES" : "NO"}`
    );
    if (baseMatches.length) {
      lines.push(
        `Base source: ${baseMatches.map(record => record.class_source).join(", ")}`
      );
    }
    if (variantMatches.length) {
      lines.push(
        "",
        "Optional class-list additions:",
        ...variantMatches.map(record => {
          const defined = record.defined_in_sources?.length
            ? `; enabled by ${record.defined_in_sources.join(", ")}`
            : "";
          return `- ${record.class_name} [optional class list${defined}]`;
        })
      );
    }
    lines.push("", "Conditional access:");
    if (classConditional.length) {
      lines.push(...classConditional.map(formatAccessRecord));
    } else {
      lines.push("- None recorded for this class.");
    }
    const generalCount = conditional.filter(record => !record.class_name).length;
    if (generalCount) {
      lines.push(
        "",
        `Other non-class-specific paths recorded: ${generalCount}. Omitted from the class verdict; query without class_name to inspect them.`
      );
    }
  } else {
    lines.push(
      "",
      "## Base class lists",
      "",
      ...(baseClasses.length
        ? baseClasses.map(record => `- ${record.class_name} (${record.class_source})`)
        : ["- None recorded."]),
      "",
      "## Optional class-list additions",
      "",
      ...(optionalLists.length
        ? optionalLists.map(record => {
          const defined = record.defined_in_sources?.length
            ? `; enabled by ${record.defined_in_sources.join(", ")}`
            : "";
          return `- ${record.class_name} (${record.class_source}${defined})`;
        })
        : ["- None recorded."]),
      "",
      "## Conditional paths",
      "",
      ...(conditional.length
        ? conditional.slice(0, 24).map(formatAccessRecord)
        : ["- None recorded."])
    );
    if (conditional.length > 24) {
      lines.push(`- [${conditional.length - 24} additional conditional paths omitted; filter with class_name.]`);
    }
  }

  lines.push(
    "",
    "Coverage note: base lists are structured for the catalog's listed sources. A `discovery-only` conditional path identifies where to look, but does not establish whether the spell is automatic, prepared, known, or merely selectable."
  );
  return truncate(lines.join("\n"));
}

function readForward(abs, line, count) {
  const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
  const start = Math.max(0, line - 1);
  return lines.slice(start, Math.min(lines.length, start + count)).join("\n");
}

function monsterBodyScore(text) {
  const patterns = [
    /(?:\*{0,2}\bArmor Class\b\*{0,2}|\*{0,2}\bAC\b\*{0,2})\s*:?\s*\d/i,
    /(?:\*{0,2}\bHit Points\b\*{0,2}|\*{0,2}\bHP\b\*{0,2})\s*:?\s*\d/i,
    /\*{0,2}\bSpeed\b\*{0,2}[^\n]{0,30}\d/i,
    /(?:\*{0,2}\bChallenge\b\*{0,2}|\*{0,2}\bCR\b\*{0,2})[^\n]{0,40}\d/i,
    /\bSTR\b[\s\S]{0,180}\bDEX\b[\s\S]{0,180}\bCON\b/i
  ];
  return patterns.reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0);
}

function itemBodyScore(text) {
  const standardDeclaration = /\b(?:Wondrous item|Potion|Weapon|Armor|Ammunition|Ring|Rod|Staff|Wand|Scroll)\b[^\n]{0,100}\b(?:common|uncommon|rare|very rare|legendary|artifact|rarity varies)\b/i;
  const labeledDeclaration = /\bRarity\s*:\s*(?:varies|common|uncommon|rare|very rare|legendary|artifact)\b[\s\S]{0,160}\bType\s*:\s*\S+/i;
  return standardDeclaration.test(text) || labeledDeclaration.test(text) ? 2 : 0;
}

function isMixedColumnSourceRow(text) {
  const value = String(text || "");
  for (const match of value.matchAll(/ {12,}/g)) {
    const left = value.slice(0, match.index);
    const right = value.slice(match.index + match[0].length);
    if (/[A-Za-z0-9]/.test(left) && /[A-Za-z0-9]/.test(right)) return true;
  }
  return false;
}

function srdTerminalIsMissing(primaryText, lib, srdHit) {
  const abs = path.resolve(lib.root, srdHit.file);
  const window = readBodyWindow(abs, srdHit.line, MAX_BODY_LINES);
  const terminal = window.text
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*\d+\s+\|\s?/, "").trim())
    .filter(Boolean)
    .at(-1);
  const expected = topicTerms(terminal);
  if (expected.length < 2) return false;
  const actual = new Set(topicTerms(primaryText));
  return expected.filter(term => !actual.has(term)).length >= 2;
}

function entityBodyScore(type, text) {
  if (type === "monster") return monsterBodyScore(text);
  if (type === "item") return itemBodyScore(text);
  return 0;
}

function entityBodyThreshold(type) {
  return type === "monster" ? 4 : 2;
}

function isPotentialStructuredEntityHeading(text) {
  const value = String(text || "").trim();
  if (!isPotentialAllCapsHeading(value) || /\d/.test(value)) return false;
  if (/^(?:(?:STR|DEX|CON|INT|WIS|CHA)\s*){3,}$/i.test(value)) return false;
  return !/^(?:ACTIONS?|BONUS ACTIONS?|REACTIONS?|LEGENDARY ACTIONS?|MYTHIC ACTIONS?|LAIR ACTIONS?|REGIONAL EFFECTS?)$/i.test(value);
}

function nextStructuredHeadingIndex(entries, type) {
  for (let index = 1; index < entries.length; index += 1) {
    if (!isPotentialStructuredEntityHeading(entries[index].text)) continue;
    const nextHeadingOffset = entries
      .slice(index + 1)
      .findIndex(entry => isPotentialStructuredEntityHeading(entry.text));
    const candidateEnd = nextHeadingOffset < 0
      ? index + 12
      : Math.min(index + 12, index + 1 + nextHeadingOffset);
    const candidate = entries
      .slice(index, candidateEnd)
      .map(entry => entry.text)
      .join("\n");
    if (entityBodyScore(type, candidate) >= entityBodyThreshold(type)) return index;
  }
  return entries.length;
}

function nextRuleHeadingIndex(entries) {
  for (let index = 1; index < entries.length; index += 1) {
    if (!isPotentialAllCapsHeading(entries[index].text)) continue;
    const candidateEntries = entries.slice(index, index + 12);
    const candidate = candidateEntries.map(entry => entry.text).join("\n");
    const proseLines = candidateEntries.slice(1).filter(entry => {
      const words = entry.text.match(/[A-Za-z]{2,}/g) || [];
      return words.length >= 6 && !/\.{4,}/.test(entry.text);
    }).length;
    if (
      proseLines >= 2
      || entityBodyScore("monster", candidate) >= entityBodyThreshold("monster")
      || entityBodyScore("item", candidate) >= entityBodyThreshold("item")
    ) {
      return index;
    }
  }
  return entries.length;
}

function logicalStructuredBody(lib, abs, sourceLine, names, type = null) {
  if (!isReflowEligible(lib, abs)) return null;
  const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
  const view = pageViewForLine(lines, sourceLine);
  if (view.mode !== "columns") return null;
  const selector = headingSelector(lines, sourceLine, names);
  if (!selector || !["L", "R"].includes(selector.column)) return null;

  const startIndex = view.entries.findIndex(entry => (
    entry.sourceLine === sourceLine && entry.column === selector.column
  ));
  if (startIndex < 0) return null;
  let entries = view.entries.slice(startIndex, startIndex + MAX_BODY_LINES);
  if (["monster", "item"].includes(type)) {
    entries = entries.slice(0, nextStructuredHeadingIndex(entries, type));
  } else if (type === "rule") {
    entries = entries.slice(0, nextRuleHeadingIndex(entries));
  }
  if (!entries.length) return null;
  return {
    start: entries[0].sourceLine,
    end: entries.at(-1).sourceLine,
    pageNumber: view.pageNumber,
    mode: "columns",
    label: readingOrderLabel("columns", view.pageNumber),
    text: formatPageEntries(entries),
    validationText: entries.map(entry => entry.text).join("\n")
  };
}

function bodyLineBudget(hit, type, contextLines) {
  const siblingOrSrd = hit.file.startsWith(`..${path.sep}`) || hit.file.startsWith("../");
  if (siblingOrSrd) return MAX_BODY_LINES;
  if (type === "monster") return Math.max(contextLines + 1, 56);
  return Math.max(contextLines + 1, 32);
}

function phraseOccurrences(text, phrase) {
  const compactText = compactLetters(text);
  const compactPhrase = compactLetters(phrase);
  if (!compactPhrase) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = compactText.indexOf(compactPhrase, offset)) >= 0) {
    count++;
    offset += compactPhrase.length;
  }
  return count;
}

function ruleBodyAssessment(lib, abs, hit, variants) {
  const bodyWindow = logicalStructuredBody(lib, abs, hit.line, variants, "rule");
  const text = bodyWindow?.validationText || readForward(abs, hit.line, 28);
  const relevance = Math.max(...variants.map(variant => phraseOccurrences(text, variant)));
  const lines = text.split(/\r?\n/);
  const proseLines = lines.filter(line => {
    const words = line.match(/[A-Za-z]{2,}/g) || [];
    return words.length >= 7 && !/\.{4,}/.test(line);
  }).length;
  const directoryLines = lines.filter(line =>
    /\.{4,}/.test(line)
    || /(?:,\s*\d{1,3}){2,}/.test(line)
  ).length;
  return {
    score: relevance * 30 + Math.min(proseLines, 10) * 2 - directoryLines * 8,
    bodyWindow
  };
}

function catalogEntityHits(lib, name, type, requestedSet) {
  const hits = [];
  for (const entry of catalogHits(lib, name, type)) {
    for (const book of entry.books || []) {
      if (requestedSet && !requestedSet.has(book.code)) continue;
      const installed = lib.books.get(book.code);
      if (!installed) continue;
      for (const hit of book.hits || []) {
        hits.push({
          code: book.code,
          book: book.short || installed.short,
          file: path.relative(lib.root, installed.abs),
          line: hit.line,
          pdf_page: hit.pdf_page || pageForLine(lib, book.code, hit.line),
          match: hit.pattern || entry.name,
          score: 0
        });
      }
    }
  }
  return hits;
}

function lookupStructuredEntity(lib, name, type, books, maxResults, contextLines) {
  const requestedCodes = parseBookList(books, lib);
  if (books) selectedFiles(lib, books, type);
  const requestedSet = requestedCodes ? new Set(requestedCodes) : null;
  const variants = knownVariants(lib, name);
  const primaryPhb = lib.books.has("phb24") ? "phb24" : "phb14";
  const primaryMonsterBook = lib.books.has("mm24") ? "mm24" : "mm14";
  const allowSrdFallback = !requestedSet
    || (type === "monster" ? requestedSet.has(primaryMonsterBook) : requestedSet.has(primaryPhb) || requestedSet.has("dmg14") || requestedSet.has("dmg24"));
  const candidates = catalogEntityHits(lib, name, type, requestedSet);
  for (const variant of variants) {
    candidates.push(...strictHeadingHits(lib, variant, { books, type }));
  }
  const valid = [];
  for (const hit of sortHits(lib, uniqueHits(candidates), books, type)) {
    const abs = path.resolve(lib.root, hit.file);
    if (!fs.existsSync(abs)) continue;
    const lineText = fs.readFileSync(abs, "utf8").split(/\r?\n/)[hit.line - 1] || "";
    const headingScore = Math.max(...variants.map(variant => headingSegmentScore(lineText, variant)));
    const validationLines = type === "monster" ? 50 : 24;
    const bodyWindow = logicalStructuredBody(
      lib,
      abs,
      hit.line,
      variants,
      type
    );
    const bodyText = bodyWindow?.validationText || readForward(abs, hit.line, validationLines);
    const bodyScore = entityBodyScore(type, bodyText);
    const threshold = entityBodyThreshold(type);
    if (!headingScore || bodyScore < threshold) continue;
    valid.push({ ...hit, score: headingScore + bodyScore, bodyWindow });
  }
  const sorted = sortHits(lib, uniqueHits(valid), books, type).slice(0, maxResults);
  if (sorted.length) {
    const primary = sorted[0];
    if (type === "item" && allowSrdFallback && !primary.bodyWindow) {
      const abs = path.resolve(lib.root, primary.file);
      const lineText = fs.readFileSync(abs, "utf8").split(/\r?\n/)[primary.line - 1] || "";
      if (isMixedColumnSourceRow(lineText)) {
        const srdHits = uniqueHits(variants.flatMap(variant => (
          srdHeadingHits(lib, variant, type, maxResults)
        ))).slice(0, maxResults);
        const primaryText = readForward(abs, primary.line, 24);
        if (srdHits.length && srdTerminalIsMissing(primaryText, lib, srdHits[0])) {
          const page = primary.pdf_page ? `, pdf p.${primary.pdf_page}` : "";
          return [
            `CAUTION: Primary ${primary.book || primary.code} ${primary.file}:${primary.line}${page} is a low-confidence mixed-column OCR hit; returning the same-edition SRD body instead.`,
            "",
            formatBodySearch(lib, srdHits, bodyLineBudget(srdHits[0], type, contextLines))
          ].join("\n");
        }
      }
    }
    return formatBodySearch(lib, sorted, bodyLineBudget(sorted[0], type, contextLines));
  }

  for (const variant of variants) {
    for (const hit of fuzzyHeadingHits(lib, variant, { books, type })) {
      const abs = path.resolve(lib.root, hit.file);
      const validationLines = type === "monster" ? 50 : 24;
      const bodyWindow = logicalStructuredBody(
        lib,
        abs,
        hit.line,
        variants,
        type
      );
      const bodyText = bodyWindow?.validationText || readForward(abs, hit.line, validationLines);
      if (entityBodyScore(type, bodyText) < entityBodyThreshold(type)) continue;
      valid.push({ ...hit, bodyWindow });
      if (valid.length >= maxResults) break;
    }
    if (valid.length) break;
  }
  if (valid.length) {
    return formatBodySearch(
      lib,
      valid.slice(0, maxResults),
      bodyLineBudget(valid[0], type, contextLines)
    );
  }

  if (allowSrdFallback) {
    for (const variant of variants) {
      const hits = srdHeadingHits(lib, variant, type, maxResults);
      if (hits.length) {
        return formatBodySearch(
          lib,
          hits,
          bodyLineBudget(hits[0], type, contextLines)
        );
      }
    }
  }
  return `No local ${type}-body match. List/table/incidental hits were ignored; try a source-specific lookup card or external verification.`;
}

function lookupEntity(lib, name, type, books, maxResults, contextLines) {
  if (type === "spell") {
    return lookupSpellEntity(lib, name, books, maxResults, contextLines);
  }
  if (["monster", "item"].includes(type)) {
    return lookupStructuredEntity(lib, name, type, books, maxResults, contextLines);
  }
  return formatSearch(lib, rgSearch(lib, name, { books, type, maxResults }), contextLines);
}

function lookupRuleTopic(lib, topic, books, maxResults, contextLines, regex) {
  if (regex) {
    const hits = rgSearch(lib, topic, { books, type: "rule", maxResults, regex: true });
    return formatSearch(lib, hits, contextLines);
  }
  if (books) selectedFiles(lib, books, "rule");
  const structuredTable = lookupStructuredRuleTable(lib, topic, books);
  if (structuredTable) return structuredTable;
  const variants = knownVariants(lib, topic);
  for (const entry of ruleCatalogHits(lib, topic)) variants.push(entry.name);
  const uniqueVariants = [...new Set(variants)];
  const headingCandidates = [];
  for (let index = 0; index < uniqueVariants.length; index++) {
    const variant = uniqueVariants[index];
    const canonicalBoost = index === 0 && compactLetters(variant) !== compactLetters(topic) ? 100 : 0;
    headingCandidates.push(
      ...strictHeadingHits(lib, variant, { books, type: "rule" })
        .map(hit => ({ ...hit, score: (hit.score || 0) + canonicalBoost }))
    );
  }
  const scoredHeadings = uniqueHits(headingCandidates).map(hit => {
    const abs = path.resolve(lib.root, hit.file);
    const assessment = ruleBodyAssessment(lib, abs, hit, uniqueVariants);
    return {
      ...hit,
      score: (hit.score || 0) + assessment.score,
      orderedWindow: assessment.bodyWindow
    };
  });
  const headings = sortHits(lib, scoredHeadings, books, "rule").slice(0, maxResults);
  if (headings.length) return formatSearch(lib, headings, Math.max(contextLines, 18));

  const fuzzyCandidates = [];
  for (let index = 0; index < uniqueVariants.length; index++) {
    const variant = uniqueVariants[index];
    const canonicalBoost = index === 0 && compactLetters(variant) !== compactLetters(topic) ? 100 : 0;
    fuzzyCandidates.push(
      ...fuzzyHeadingHits(lib, variant, { books, type: "rule" })
        .map(hit => ({ ...hit, score: (hit.score || 0) + canonicalBoost }))
    );
  }
  const scoredFuzzy = uniqueHits(fuzzyCandidates).map(hit => {
    const abs = path.resolve(lib.root, hit.file);
    const assessment = ruleBodyAssessment(lib, abs, hit, uniqueVariants);
    return {
      ...hit,
      score: (hit.score || 0) + assessment.score,
      orderedWindow: assessment.bodyWindow
    };
  });
  const fuzzy = sortHits(lib, scoredFuzzy, books, "rule").slice(0, maxResults);
  if (fuzzy.length) return formatSearch(lib, fuzzy, Math.max(contextLines, 18));

  const phraseHits = [];
  for (const variant of uniqueVariants) {
    phraseHits.push(...rgSearch(lib, variant, {
      books,
      type: "rule",
      maxResults: MAX_RESULTS,
      regex: false
    }));
  }
  const ordered = sortHits(lib, uniqueHits(phraseHits), books, "rule").slice(0, maxResults);
  if (ordered.length) return formatSearch(lib, ordered, contextLines);

  const topicHits = topicFallbackHits(lib, topic, books, maxResults);
  if (topicHits.length) {
    return formatSearch(lib, topicHits, Math.max(contextLines, 18));
  }

  if (books) return formatSearch(lib, [], contextLines);
  const routeHits = rgSearch(lib, topic, {
    type: "rule",
    includeLookups: true,
    maxResults,
    regex: false
  }).filter(hit => hit.file.startsWith("lookups/"));
  return formatSearch(lib, routeHits, contextLines);
}

function textResponse(text) {
  return { content: [{ type: "text", text }] };
}

function buildServer() {
  const server = new McpServer({
    name: "core-rules-mcp",
    version: "0.1.0"
  });

  server.tool(
    "list_core_books",
    "List installed local D&D 5e rules books and cache files for this MCP instance.",
    {},
    async () => {
      const lib = loadLibrary();
      const label = process.env.CORE_RULES_LABEL || lib.manifest.library || "core rules";
      const rows = [...lib.books.values()].map(b => `- ${b.short} (${b.code}) — ${b.title}; file ${b.full_source_file}; ${b.full_source_lines} lines; priority ${b.priority}`);
      return textResponse(`Rules library: ${label}\nCore rules root: ${lib.root}\n\n${rows.join("\n")}`);
    }
  );

  server.tool(
    "search_core_rules",
    "Search this local rules library. Returns file/line/pdf pointers and small context windows.",
    {
      query: z.string().min(1).describe("Search text or regex."),
      books: z.union([z.string(), z.array(z.string())]).optional().describe("Optional book codes/names, e.g. userstats, ftd, frhof, frhof25, fraif25, sato23, mpp23, aag22, bam22, phb14, phb24, mm14, mm24, xge, tce, motm, mtf, scag, vgm, coa, wdmm."),
      type: z.enum(["all", "spell", "monster", "item", "rule"]).optional().default("all"),
      regex: z.boolean().optional().default(false),
      match: z.enum(["literal", "all_terms"]).optional().default("literal")
        .describe("literal keeps exact phrase order; all_terms uses a catalog/heading-anchored multi-keyword topic fallback."),
      max_results: z.number().int().min(1).max(MAX_RESULTS).optional().default(DEFAULT_MAX_RESULTS)
        .describe(`Result limit (integer, minimum 1, maximum ${MAX_RESULTS}, default ${DEFAULT_MAX_RESULTS}).`),
      context_lines: z.number().int().min(0).max(12).optional().default(DEFAULT_CONTEXT)
        .describe(`Context lines (integer, minimum 0, maximum 12, default ${DEFAULT_CONTEXT}).`)
    },
    async ({ query, books, type, regex, match, max_results, context_lines }) => {
      const lib = loadLibrary();
      if (match === "all_terms" && !regex && ["all", "rule"].includes(type)) {
        const hits = topicFallbackHits(lib, query, books, max_results);
        return textResponse(formatSearch(lib, hits, Math.max(context_lines, 18), { query }));
      }
      const hits = rgSearch(lib, query, {
        books,
        type,
        regex,
        maxResults: max_results,
        includeLookups: ["all", "rule"].includes(type)
      });
      return textResponse(formatSearch(lib, hits, context_lines, { query, regex }));
    }
  );

  server.tool(
    "open_core_rules",
    "Open a small line-numbered window from a local rules file. Auto mode reconstructs confident two-column PDF pages; reading_order=source preserves physical OCR rows.",
    {
      file: z.string().min(1).describe("Path relative to official_5e_core_rules, e.g. _full_source_phb14.md or lookups/spells_lookup.md."),
      line: z.number().int().min(1)
        .describe("Source line number (integer, minimum 1)."),
      context_lines: z.number().int().min(0).max(MAX_CONTEXT).optional().default(20)
        .describe(`Context lines (integer, minimum 0, maximum ${MAX_CONTEXT}, default 20).`),
      reading_order: z.enum(["auto", "source"]).optional().default("auto")
        .describe("auto reconstructs confident PDF columns; source preserves the original physical rows exactly.")
    },
    async ({ file, line, context_lines, reading_order }) => {
      const lib = loadLibrary();
      const abs = safeRel(lib, file);
      const code = codeForFile(lib, abs);
      const page = code ? pageForLine(lib, code, line) : null;
      const win = readOrderedWindow(lib, abs, line, context_lines, { readingOrder: reading_order });
      return textResponse(formatResultSection(
        `### ${file}:${line}${page ? `, pdf p.${page}` : ""}`,
        win
      ));
    }
  );

  server.tool(
    "lookup_spell",
    "Lookup a spell body by name. This does not establish class, subclass, or feature access.",
    {
      name: z.string().min(1),
      books: z.union([z.string(), z.array(z.string())]).optional(),
      max_results: z.number().int().min(1).max(MAX_RESULTS).optional().default(8)
        .describe(`Result limit (integer, minimum 1, maximum ${MAX_RESULTS}, default 8).`),
      context_lines: z.number().int().min(0).max(40).optional().default(DEFAULT_LOOKUP_CONTEXT)
        .describe(`Context lines (integer, minimum 0, maximum 40, default ${DEFAULT_LOOKUP_CONTEXT}).`)
    },
    async ({ name, books, max_results, context_lines }) => {
      const lib = loadLibrary();
      return textResponse(lookupEntity(lib, name, "spell", books, max_results, context_lines));
    }
  );

  server.tool(
    "lookup_spell_access",
    "Lookup edition-specific class, subclass, invocation, and other structured access paths for a spell. Never infers access from OCR.",
    {
      name: z.string().min(1),
      class_name: z.string().min(1).optional()
        .describe("Optional class filter, e.g. Warlock, Cleric, 邪术士, or 牧师.")
    },
    async ({ name, class_name }) => {
      const lib = loadLibrary();
      return textResponse(lookupSpellAccess(lib, name, class_name));
    }
  );

  server.tool(
    "lookup_monster",
    "Lookup a monster by name in installed local monster sources.",
    {
      name: z.string().min(1),
      books: z.union([z.string(), z.array(z.string())]).optional(),
      max_results: z.number().int().min(1).max(MAX_RESULTS).optional().default(10)
        .describe(`Result limit (integer, minimum 1, maximum ${MAX_RESULTS}, default 10).`),
      context_lines: z.number().int().min(0).max(40).optional().default(DEFAULT_LOOKUP_CONTEXT)
        .describe(`Context lines (integer, minimum 0, maximum 40, default ${DEFAULT_LOOKUP_CONTEXT}).`)
    },
    async ({ name, books, max_results, context_lines }) => {
      const lib = loadLibrary();
      return textResponse(lookupEntity(lib, name, "monster", books, max_results, context_lines));
    }
  );

  server.tool(
    "lookup_item",
    "Lookup a magic item, mundane item, artifact, boon, or reward by name.",
    {
      name: z.string().min(1),
      books: z.union([z.string(), z.array(z.string())]).optional(),
      max_results: z.number().int().min(1).max(MAX_RESULTS).optional().default(8)
        .describe(`Result limit (integer, minimum 1, maximum ${MAX_RESULTS}, default 8).`),
      context_lines: z.number().int().min(0).max(40).optional().default(DEFAULT_LOOKUP_CONTEXT)
        .describe(`Context lines (integer, minimum 0, maximum 40, default ${DEFAULT_LOOKUP_CONTEXT}).`)
    },
    async ({ name, books, max_results, context_lines }) => {
      const lib = loadLibrary();
      return textResponse(lookupEntity(lib, name, "item", books, max_results, context_lines));
    }
  );

  server.tool(
    "lookup_rule_topic",
    "Lookup a rule topic, subsystem, class feature, feat, condition, species/race, lineage, background, character-creation option, or DMG procedure.",
    {
      topic: z.string().min(1),
      books: z.union([z.string(), z.array(z.string())]).optional(),
      max_results: z.number().int().min(1).max(MAX_RESULTS).optional().default(10)
        .describe(`Result limit (integer, minimum 1, maximum ${MAX_RESULTS}, default 10).`),
      context_lines: z.number().int().min(0).max(12).optional().default(5)
        .describe("Context lines (integer, minimum 0, maximum 12, default 5). Use open_core_rules for a wider window."),
      regex: z.boolean().optional().default(false)
    },
    async ({ topic, books, max_results, context_lines, regex }) => {
      const lib = loadLibrary();
      return textResponse(lookupRuleTopic(lib, topic, books, max_results, context_lines, regex));
    }
  );

  return server;
}

async function selftest() {
  const lib = loadLibrary();
  const books = [...lib.books.keys()];
  if (!books.length) throw new Error("expected at least one installed book");
  const is2014Library = books.includes("phb14");
  const is2024Library = books.includes("phb24");
  const optional2014Codes = ["userstats", "coa", "frhof", "wdmm", "ftd", "sato23", "mpp23", "aag22", "bam22"];
  if (!is2014Library && optional2014Codes.some(code => books.includes(code))) {
    throw new Error("2024 core-rules instance must not register 2014/module sibling caches");
  }
  if (is2014Library && ["fraif25", "frhof25"].some(code => books.includes(code))) {
    throw new Error("2014 core-rules instance must not register 2025 Realms full-book caches");
  }
  const expectedCoa = is2014Library && fs.existsSync(path.resolve(lib.root, "../official_5e_coa/coa_bestiary_full.md"));
  if (expectedCoa && !books.includes("coa")) {
    throw new Error("Optional CoA bestiary cache exists but was not registered as book code coa");
  }
  const expectedFrhof = is2014Library && fs.existsSync(path.resolve(lib.root, "../official_2025_faerun/frhof_spells_full.md"));
  if (expectedFrhof && !books.includes("frhof")) {
    throw new Error("FRHoF spell index exists but was not registered as book code frhof");
  }
  if (!lib.spellAccess) {
    throw new Error("Spell-access catalog is missing");
  }
  if (is2014Library) {
    const disguise = lookupSpellAccess(lib, "Disguise Self", "Warlock");
    if (
      !disguise.includes("Base-list verdict: NO")
      || !disguise.includes("Mask of Many Faces")
      || !/at[- ]will/i.test(disguise)
    ) {
      throw new Error("2014 Warlock Disguise Self access guard failed");
    }
    const fiend = lookupSpellAccess(lib, "Burning Hands", "Warlock");
    if (
      !fiend.includes("expanded choice")
      || !fiend.includes("not automatically known")
      || fiend.includes("always prepared")
    ) {
      throw new Error("2014 Fiend expanded-choice semantics failed");
    }
  }
  if (is2024Library) {
    const fiend = lookupSpellAccess(lib, "Burning Hands", "Warlock");
    if (
      !fiend.includes("Fiend Patron")
      || !fiend.includes("Warlock level 3")
      || !fiend.includes("always prepared")
      || fiend.includes("expanded choice")
    ) {
      throw new Error("2024 Fiend always-prepared semantics failed");
    }
  }
  console.log(`spell_access_catalog=${lib.spellAccess.edition}:${lib.spellAccess.entry_count}`);
  const expectedFraifFull = is2024Library && fs.existsSync(path.resolve(lib.root, "../official_2025_faerun/_full_source_fraif.md"));
  if (expectedFraifFull && !books.includes("fraif25")) {
    throw new Error("FRAIF full source exists but was not registered as book code fraif25");
  }
  const expectedFrhofFull = is2024Library && fs.existsSync(path.resolve(lib.root, "../official_2025_faerun/_full_source_frhof.md"));
  if (expectedFrhofFull && !books.includes("frhof25")) {
    throw new Error("FRHoF full source exists but was not registered as book code frhof25");
  }
  const expectedWdmm = is2014Library && fs.existsSync(path.resolve(lib.root, "../official_5e_wdmm/_full_source.md"));
  if (expectedWdmm && !books.includes("wdmm")) {
    throw new Error("WDMM module source exists but was not registered as book code wdmm");
  }
  const expectedFtd = is2014Library && fs.existsSync(path.resolve(lib.root, "../official_5e_fizban_dragons/ftd_mechanics_full.md"));
  if (expectedFtd && !books.includes("ftd")) {
    throw new Error("FTD mechanics cache exists but was not registered as book code ftd");
  }
  for (const [code, rel] of [
    ["sato23", "../official_5e_planescape/_full_source_sigil_and_outlands.md"],
    ["mpp23", "../official_5e_planescape/_full_source_mortes_planar_parade.md"],
    ["aag22", "../official_5e_spelljammer/_full_source_astral_adventurers_guide.md"],
    ["bam22", "../official_5e_spelljammer/_full_source_boos_astral_menagerie.md"]
  ]) {
    const expected = is2014Library && fs.existsSync(path.resolve(lib.root, rel));
    if (expected && !books.includes(code)) {
      throw new Error(`Optional multiverse source exists but was not registered as book code ${code}`);
    }
  }
  const expectedUserStats = is2014Library && fs.existsSync(path.resolve(lib.root, "../user_provided_statblocks/user_statblocks_full.md"));
  if (expectedUserStats && !books.includes("userstats")) {
    throw new Error("User-provided stat-block cache exists but was not registered as book code userstats");
  }
  if (books.includes("userstats")) {
    const szass = lookupEntity(lib, "Szass Tam, the Regent of Thay", "monster", ["userstats"], 3, 40);
    if (!szass.includes("## Szass Tam, the Regent of Thay") || !szass.includes("**HP** 589") || !szass.includes("**CR** 30")) {
      throw new Error("User-provided Szass Tam transcription lookup failed");
    }
    const defaultSzass = lookupEntity(lib, "Szass Tam, the Regent of Thay", "monster", null, 3, 40);
    if (!defaultSzass.includes("UserStats") || !defaultSzass.includes("community/transposed reference")) {
      throw new Error("Default monster lookup did not expose the user-provided Szass Tam provenance");
    }
    const userStatsAbs = safeRel(lib, "../user_provided_statblocks/user_statblocks_full.md");
    const userStatsBaseAbs = safeRel(lib, "user_statblocks_full.md");
    if (userStatsAbs !== userStatsBaseAbs || !readWindow(userStatsAbs, 1, 3).text.includes("User-Provided Stat Blocks")) {
      throw new Error("User-provided stat-block sibling open resolution failed");
    }
    const userStatsText = fs.readFileSync(userStatsAbs, "utf8");
    for (const required of ["Formulaic Mind", "Chain Lightning", "Devastating Counter", "Rework the Weave"]) {
      if (!userStatsText.includes(required)) throw new Error(`User-provided Szass Tam transcription is incomplete: ${required}`);
    }
    console.log("user_statblocks=ok");
  }
  if (books.includes("fraif25")) {
    const fraifHits = rgSearch(lib, "Baldur's Gate Gazetteer", {
      books: "fraif",
      type: "all",
      maxResults: 3
    });
    if (!fraifHits.length || fraifHits[0].code !== "fraif25") {
      throw new Error("FRAIF full-source alias/search failed");
    }
    const fraifAbs = safeRel(lib, "../official_2025_faerun/_full_source_fraif.md");
    if (!readWindow(fraifAbs, 1, 15).text.includes("source_id: fraif25")) {
      throw new Error("FRAIF full-source sibling open failed");
    }
    console.log("fraif25_full_source=ok");
  }
  if (books.includes("frhof25")) {
    const frhofFullHits = rgSearch(lib, "Circle Magic", {
      books: "frhof full",
      type: "all",
      maxResults: 3
    });
    if (!frhofFullHits.length || frhofFullHits[0].code !== "frhof25") {
      throw new Error("FRHoF full-source alias/search failed");
    }
    const frhofFullAbs = safeRel(lib, "../official_2025_faerun/_full_source_frhof.md");
    if (!readWindow(frhofFullAbs, 1, 15).text.includes("source_id: frhof25")) {
      throw new Error("FRHoF full-source sibling open failed");
    }
    console.log("frhof25_full_source=ok");
  }
  if (books.includes("ftd")) {
    const red = lookupEntity(lib, "Red Greatwyrm", "monster", ["ftd"], 3, 40);
    if (!red.includes("Chromatic Awakening") || !red.includes("resets to 425 hit points") || !red.includes("Mythic Actions")) {
      throw new Error("FTD Red Greatwyrm mythic lookup failed");
    }
    const amethyst = lookupEntity(lib, "Amethyst Greatwyrm", "monster", ["ftd"], 3, 40);
    if (!amethyst.includes("Gem Awakening") || !amethyst.includes("Mass Telekinesis")) {
      throw new Error("FTD Amethyst Greatwyrm awakening lookup failed");
    }
    const gold = lookupEntity(lib, "Gold Greatwyrm", "monster", ["ftd"], 3, 40);
    if (!gold.includes("Metallic Awakening") || !gold.includes("Mythic Actions")) {
      throw new Error("FTD Gold Greatwyrm mythic lookup failed");
    }
    const bahamut = lookupEntity(lib, "Aspect of Bahamut", "monster", ["ftd"], 3, 40);
    if (!bahamut.includes("Platinum Brilliance") || !bahamut.includes("Celestial Lances")) {
      throw new Error("FTD Aspect of Bahamut mythic lookup failed");
    }
    const tiamat = lookupEntity(lib, "Aspect of Tiamat", "monster", ["ftd"], 3, 40);
    if (!tiamat.includes("Chromatic Wrath") || !tiamat.includes("Hurl Through Avernus")) {
      throw new Error("FTD Aspect of Tiamat mythic lookup failed");
    }
    const spell = lookupEntity(lib, "Rime's Binding Ice", "spell", ["ftd"], 3, 28);
    if (!spell.includes("30 feet") || !spell.includes("Casting Time")) throw new Error("FTD spell lookup failed");
    const item = lookupEntity(lib, "Dragon's Wrath Weapon", "item", ["ftd"], 3, 30);
    if (!item.includes("## Dragon's Wrath Weapon")) throw new Error("FTD item lookup failed");
    for (const topic of ["Gift of the Gem Dragon", "Dragonborn (Gem)", "Drakewarden", "Echo of Dragonsight", "Creating a Hoard"]) {
      const result = lookupEntity(lib, topic, "rule", ["ftd"], 3, 30);
      if (!result.includes(topic)) throw new Error(`FTD rule lookup failed: ${topic}`);
    }
    const defaultRed = lookupEntity(lib, "Red Greatwyrm", "monster", null, 3, 40);
    if (!defaultRed.includes("FTD") || !defaultRed.includes("Chromatic Awakening")) {
      throw new Error("Default monster lookup did not include FTD Red Greatwyrm");
    }
    const aliasHit = rgSearch(lib, "Chromatic Awakening", { books: "fizban", type: "monster", maxResults: 3 });
    if (!aliasHit.length || aliasHit[0].code !== "ftd") throw new Error("FTD alias lookup failed");
    const ftdAbs = safeRel(lib, "../official_5e_fizban_dragons/ftd_mechanics_full.md");
    if (!readWindow(ftdAbs, 1, 2).text.includes("FTD Mechanics")) throw new Error("FTD sibling open resolution failed");
    console.log("ftd_mechanics=ok");
  }
  if (books.includes("wdmm")) {
    const halasterWdmm = lookupEntity(lib, "Halaster Blackcloak", "monster", ["wdmm"], 3, DEFAULT_LOOKUP_CONTEXT);
    if (!halasterWdmm.includes("## Halaster Blackcloak") || !halasterWdmm.includes("CR 23") || !halasterWdmm.includes("HP 246")) {
      throw new Error("WDMM Halaster Blackcloak lookup failed");
    }
    const arcturiaDefault = lookupEntity(lib, "Arcturia", "monster", null, 3, 25);
    if (!arcturiaDefault.includes("WDMM") || !arcturiaDefault.includes("## Arcturia") || !arcturiaDefault.includes("Legendary Resistance")) {
      throw new Error("Default monster lookup did not include WDMM Arcturia");
    }
    const wdmmAbs = safeRel(lib, "../official_5e_wdmm/wdmm_bestiary_full.md");
    const wdmmBaseAbs = safeRel(lib, "wdmm_bestiary_full.md");
    if (wdmmAbs !== wdmmBaseAbs || !readWindow(wdmmAbs, 1251, 1).text.includes("## Halaster Blackcloak")) {
      throw new Error("WDMM sibling open resolution failed");
    }
    const wdmmAlias = rgSearch(lib, "Halaster Blackcloak", { books: "undermountain", type: "monster", maxResults: 3 });
    if (!wdmmAlias.length || wdmmAlias[0].code !== "wdmm") throw new Error("WDMM alias lookup failed");
    console.log("wdmm_bestiary=ok");
  }
  if (books.includes("frhof")) {
    const mystraStar = lookupEntity(lib, "Holy Star of Mystra", "spell", ["frhof"], 3, DEFAULT_LOOKUP_CONTEXT);
    if (!mystraStar.includes("## Holy Star of Mystra") || !mystraStar.includes("4d10") || !mystraStar.includes("Three-Quarters Cover")) {
      throw new Error("FRHoF Holy Star of Mystra lookup failed");
    }
    const frhofAbs = safeRel(lib, "../official_2025_faerun/frhof_spells_full.md");
    const frhofBaseAbs = safeRel(lib, "frhof_spells_full.md");
    if (frhofAbs !== frhofBaseAbs || !readWindow(frhofAbs, 388, 1).text.includes("Holy Star of Mystra")) {
      throw new Error("FRHoF sibling open resolution failed");
    }
    const bladeDefault = lookupEntity(lib, "Blade of Disaster", "spell", null, 3, DEFAULT_LOOKUP_CONTEXT);
    if (!bladeDefault.includes("FRHoF") || !bladeDefault.includes("## Blade of Disaster") || !bladeDefault.includes("10d6")) {
      throw new Error("Default spell lookup did not prefer FRHoF Blade of Disaster");
    }
    const frhofAlias = rgSearch(lib, "Holy Star of Mystra", { books: "heroes of faerun spells", type: "spell", maxResults: 3 });
    if (!frhofAlias.length || frhofAlias[0].code !== "frhof") throw new Error("FRHoF alias lookup failed");
    console.log("frhof_spells=ok");
  }
  if (books.includes("coa")) {
    const asmodeusCoa = lookupEntity(lib, "Asmodeus", "monster", ["coa"], 3, DEFAULT_LOOKUP_CONTEXT);
    if (!asmodeusCoa.includes("## Asmodeus") || !asmodeusCoa.includes("CR 30") || !asmodeusCoa.includes("HP 725")) {
      throw new Error("CoA Asmodeus lookup failed");
    }
    const coaAbs = safeRel(lib, "../official_5e_coa/coa_bestiary_full.md");
    const coaBaseAbs = safeRel(lib, "coa_bestiary_full.md");
    if (coaAbs !== coaBaseAbs || !readWindow(coaAbs, 172, 1).text.includes("## Asmodeus")) {
      throw new Error("CoA sibling open resolution failed");
    }
    const zarielDefault = lookupEntity(lib, "Zariel", "monster", null, 3, DEFAULT_LOOKUP_CONTEXT);
    if (!zarielDefault.includes("CoA") || !zarielDefault.includes("## Zariel") || !zarielDefault.includes("HP 420")) {
      throw new Error("Default monster lookup did not prefer CoA Zariel");
    }
    const coaAlias = rgSearch(lib, "Fiendish Regeneration", { books: "chains of asmodeus", type: "monster", maxResults: 3 });
    if (!coaAlias.length || coaAlias[0].code !== "coa") throw new Error("CoA alias lookup failed");
    console.log("coa_bestiary=ok");
  }
  if (books.includes("phb14")) {
    const fireballText = lookupEntity(lib, "fireball", "spell", ["phb14"], 3, DEFAULT_LOOKUP_CONTEXT);
    if (!fireballText.includes("FIREBALL") || !fireballText.includes("8d6")) {
      throw new Error("Fireball precise spell lookup failed");
    }
    const controlWeatherText = lookupEntity(lib, "Control Weather", "spell", ["phb14"], 3, DEFAULT_LOOKUP_CONTEXT);
    if (!controlWeatherText.includes("You take control of the weather within 5 miles") || !controlWeatherText.includes("Casting Time")) {
      throw new Error("Control Weather spell lookup returned a list hit instead of the spell body");
    }
    const counterspellText = lookupEntity(lib, "Counterspell", "spell", ["phb14"], 3, DEFAULT_LOOKUP_CONTEXT);
    if (!counterspellText.includes("You attempt to interrupt a creature") || !counterspellText.includes("Casting Time")) {
      throw new Error("Counterspell catalog hit was not filtered to the spell body");
    }
    const absorbElementsText = lookupEntity(lib, "Absorb Elements", "spell", ["xge"], 3, DEFAULT_LOOKUP_CONTEXT);
    if (!absorbElementsText.includes("resistance to the triggering damage") || !absorbElementsText.includes("Casting Time")) {
      throw new Error("XGE Absorb Elements catalog hit was not filtered to the spell body");
    }
    const boomingBladeText = lookupEntity(lib, "Booming Blade", "spell", ["tce"], 3, DEFAULT_LOOKUP_CONTEXT);
    if (!boomingBladeText.includes("You brandish the weapon used in the spell") || !boomingBladeText.includes("Casting T")) {
      throw new Error("TCE Booming Blade catalog/TOC hit was not filtered to the spell body");
    }
    const otherworldlyGuiseText = lookupEntity(lib, "Tasha's Otherworldly Guise", "spell", ["tce"], 3, DEFAULT_LOOKUP_CONTEXT);
    if (!otherworldlyGuiseText.includes("Uttering an incantation") || !otherworldlyGuiseText.includes("Casting Time")) {
      throw new Error("TCE OCR-spaced Tasha's Otherworldly Guise lookup failed");
    }
    const lightningLureScagText = lookupEntity(lib, "Lightning Lure", "spell", ["scag"], 3, DEFAULT_LOOKUP_CONTEXT);
    if (!lightningLureScagText.includes("lash of lightning energy") || !lightningLureScagText.includes("Casting Time")) {
      throw new Error("SCAG Lightning Lure two-column spell lookup failed");
    }
    const fireball = exactHeadingHits(lib, "fireball", { books: ["phb14"], type: "spell", maxResults: 3 });
    const solar = rgSearch(lib, "Solar", { books: ["mm14"], type: "monster", maxResults: 3 });
    const boon = rgSearch(lib, "Boon of High Magic", { books: ["dmg14"], type: "rule", maxResults: 3 });
    if (!fireball.length) throw new Error("Fireball lookup failed");
    const phbAlias = rgSearch(lib, "FIREBALL", { books: "phb", type: "spell", maxResults: 1 });
    if (!phbAlias.length || phbAlias[0].code !== "phb14") throw new Error("2014 PHB alias lookup failed");
    try {
      rgSearch(lib, "Fireball", { books: "phb24", type: "spell", maxResults: 1 });
      throw new Error("2014 wrong-edition book filter did not fail");
    } catch (err) {
      if (!String(err?.message || err).includes("not installed")) throw err;
    }
    if (books.includes("mm14") && !solar.length) throw new Error("Solar lookup failed");
    if (books.includes("mm14")) {
      try {
        lookupEntity(lib, "Solar", "monster", "mm24", 1, 0);
        throw new Error("2014 catalog wrong-edition book filter did not fail");
      } catch (err) {
        if (!String(err?.message || err).includes("not installed")) throw err;
      }
    }
    if (books.includes("dmg14") && !boon.length) throw new Error("Epic boon lookup failed");
    console.log(`fireball=${fireball[0].file}:${fireball[0].line}`);
    if (solar.length) console.log(`solar=${solar[0].file}:${solar[0].line}`);
    if (boon.length) console.log(`boon=${boon[0].file}:${boon[0].line}`);
  }
  if (books.includes("phb24")) {
    const heroic = rgSearch(lib, "Heroic Inspiration", { books: ["phb24"], type: "rule", maxResults: 3 });
    const phbAlias = rgSearch(lib, "Heroic Inspiration", { books: "phb", type: "rule", maxResults: 1 });
    const exhaustion = rgSearch(lib, "Exhaustion level", { books: ["phb24"], type: "rule", maxResults: 3 });
    if (!heroic.length) throw new Error("2024 Heroic Inspiration lookup failed");
    if (!phbAlias.length || phbAlias[0].code !== "phb24") throw new Error("2024 PHB alias lookup failed");
    try {
      rgSearch(lib, "Fireball", { books: "phb14", type: "spell", maxResults: 1 });
      throw new Error("2024 wrong-edition book filter did not fail");
    } catch (err) {
      if (!String(err?.message || err).includes("not installed")) throw err;
    }
    if (!exhaustion.length) throw new Error("2024 Exhaustion lookup failed");
    console.log(`heroic_inspiration_2024=${heroic[0].file}:${heroic[0].line}`);
    console.log(`exhaustion_2024=${exhaustion[0].file}:${exhaustion[0].line}`);
  }
  if (books.includes("dmg24")) {
    const bastion = rgSearch(lib, "Bastion", { books: ["dmg24"], type: "rule", maxResults: 3 });
    if (!bastion.length) throw new Error("2024 Bastion lookup failed");
    console.log(`bastion_2024=${bastion[0].file}:${bastion[0].line}`);
  }
  if (books.includes("mtf")) {
    const bloodWar = rgSearch(lib, "Blood War", { books: ["mtf"], type: "monster", maxResults: 3 });
    const githyanki = rgSearch(lib, "Githyanki", { books: "tome of foes", type: "monster", maxResults: 3 });
    if (!bloodWar.length) throw new Error("MTF Blood War lookup failed");
    if (!githyanki.length) throw new Error("MTF alias lookup failed");
    console.log(`blood_war_mtf=${bloodWar[0].file}:${bloodWar[0].line}`);
    console.log(`githyanki_mtf=${githyanki[0].file}:${githyanki[0].line}`);
  }
  if (books.includes("mm24")) {
    const gnoll = lookupEntity(lib, "Gnoll", "monster", ["mm24"], 3, DEFAULT_LOOKUP_CONTEXT);
    if (!gnoll.includes("GNOLL")) throw new Error("2024 Gnoll lookup failed");
    console.log("gnoll_2024=ok");
  }
  console.log("SELFTEST PASS");
  console.log(`root=${lib.root}`);
  console.log(`books=${books.join(",")}`);
}

if (process.argv.includes("--selftest")) {
  selftest().catch(err => {
    console.error(err.stack || String(err));
    process.exit(1);
  });
} else {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
