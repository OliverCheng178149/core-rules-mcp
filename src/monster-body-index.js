import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const key = value => String(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const hash = data => createHash('sha256').update(data).digest('hex');
const integer = Number.isSafeInteger;
const fingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

// A complete card is a bounded, fingerprinted reading projection, not a search
// window. Raw PDF caches remain available, and OCR caveats travel with the card.
export function indexedMonsterBodies(lib, names, requestedCodes, limit) {
  const indexPath = path.join(lib.root, 'lookups', 'monster_body_index.json');
  if (!fs.existsSync(indexPath)) return {bodies: [], warning: null};
  try {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    if (index.schema_version !== 1 || !Array.isArray(index.entries)
      || index.entry_count !== index.entries.length || !index.sources
      || typeof index.sources !== 'object') throw new Error('invalid schema/count');
    const wanted = new Set(names.map(key));
    const books = requestedCodes || [...lib.books.keys()];
    let candidates = index.entries.filter(entry => entry && typeof entry.name === 'string'
      && (wanted.has(key(entry.name)) || (Array.isArray(entry.aliases) && entry.aliases.some(alias => wanted.has(key(alias))))) && books.includes(entry.book));
    // Historical lookup_aliases also contains ability names and related
    // creatures (Solar -> Flying Sword). They are search hints, not identities.
    // Prefer the literal query, then the earliest canonical alias expansion.
    const rank = entry => names.findIndex(name => key(entry.name) === key(name)
      || entry.aliases?.some(alias => key(alias) === key(name)));
    const bestRank = Math.min(...candidates.map(rank));
    candidates = candidates.filter(entry => rank(entry) === bestRank);
    const identities = new Set();
    for (const entry of candidates) {
      const id = `${entry.book}:${key(entry.name)}`;
      if (identities.has(id)) throw new Error('duplicate monster identity');
      identities.add(id);
    }
    candidates.sort((a, b) => books.indexOf(a.book) - books.indexOf(b.book));
    const sources = new Map();
    const bodies = [];
    for (const entry of candidates.slice(0, limit)) {
      const book = lib.books.get(entry.book);
      const source = index.sources[entry.book];
      if (!book || !source || source.file !== path.relative(lib.root, book.abs)
        || !fingerprint(source.sha256)) throw new Error('invalid registered source');
      // Reading projections are either the registered single-column source or
      // generated files under this instance's own lookups/monster_bodies tree.
      const reading = source.reading_file;
      const sameSource = reading === source.file;
      const readingAbs = typeof reading === 'string' ? path.resolve(lib.root, reading) : '';
      const generatedRoot = path.resolve(lib.root, 'lookups', 'monster_bodies') + path.sep;
      if (!sameSource && (!readingAbs.startsWith(generatedRoot) || path.isAbsolute(reading)))
        throw new Error('untrusted reading path');
      if (!sameSource && !fs.realpathSync(readingAbs).startsWith(fs.realpathSync(path.resolve(lib.root, "lookups", "monster_bodies")) + path.sep))
        throw new Error('untrusted reading symlink');
      if (!fingerprint(source.reading_sha256)) throw new Error('invalid reading fingerprint');
      if (!sources.has(entry.book)) {
        const raw = fs.readFileSync(book.abs);
        if (hash(raw) !== source.sha256) throw new Error(`${entry.book} source fingerprint changed`);
        const bodyRaw = sameSource ? raw : fs.readFileSync(readingAbs);
        if (hash(bodyRaw) !== source.reading_sha256) throw new Error(`${entry.book} reading fingerprint changed`);
        const lines = raw.toString('utf8').split(/\r?\n/);
        let page = null;
        const pages = lines.map(line => {
          const m = /^## PDF Page (\d+)\s*$/.exec(line);
          if (m) page = Number(m[1]);
          return page;
        });
        sources.set(entry.book, {lines, pages, readingLines: bodyRaw.toString('utf8').split(/\r?\n/)});
      }
      const {lines, pages, readingLines} = sources.get(entry.book);
      const heading = entry.heading;
      if (!heading || !integer(heading.line) || heading.line < 1 || heading.line > lines.length
        || (heading.pdf_page !== null && (!integer(heading.pdf_page)
          || pages[heading.line - 1] !== heading.pdf_page))) throw new Error('invalid source heading');
      const span = entry.body;
      if (!span || !integer(span.start) || !integer(span.end) || span.start < 1
        || span.end < span.start || span.end > readingLines.length) throw new Error('invalid body bounds');
      const body = readingLines.slice(span.start - 1, span.end).join('\n');
      if (!fingerprint(span.sha256) || hash(body) !== span.sha256) throw new Error('body fingerprint mismatch');
      const bodyRows = body.split(/\r?\n/);
      if (key(bodyRows[0].replace(/^##\s+/, '')) !== key(entry.name)
        || !/^##\s+/.test(bodyRows[0]) || bodyRows.slice(1).some(row => /^##\s+/.test(row)))
        throw new Error('body identity/neighbor boundary mismatch');
      if (typeof entry.complete !== 'boolean') throw new Error('missing completeness status');
      if (!Array.isArray(entry.warnings) || entry.warnings.some(w => typeof w !== 'string'))
        throw new Error('invalid verification warnings');
      const requestedAlias = (entry.aliases || []).find(alias => wanted.has(key(alias)));
      const variantCaution = entry.variant_notes?.length && !wanted.has(key(entry.name)) && requestedAlias
        ? [`CAUTION: Requested variant ${requestedAlias}: this is the printed base card plus variant instructions; apply the requested variant's paragraph rather than treating the unchanged base stats as a calculated variant sheet.`] : [];
      const sourcePages = entry.source_pages || [];
      if (!Array.isArray(sourcePages) || sourcePages.some(page => !integer(page) || page < 1))
        throw new Error('invalid source pages');
      const pageLabel = heading.pdf_page === null ? '' : `, pdf p.${sourcePages.length > 1 ? sourcePages.join(', ') : heading.pdf_page}`;
      bodies.push([
        `### ${book.short || entry.book}: ${entry.name} — ${source.file}:${heading.line}${pageLabel}`,
        entry.complete === false
          ? 'reading_order: indexed monster projection (source and reading SHA256 verified; EXTRACTION REVIEW REQUIRED — completeness not certified)'
          : 'reading_order: indexed monster body (source and reading SHA256 verified; complete indexed card; no line-window truncation)',
        `reading_source: ${reading}:${span.start}-${span.end}`,
        ...variantCaution,
        ...entry.warnings.map(w => `CAUTION: ${w}`),
        '', '```text', body, '```'
      ].join('\n'));
    }
    return {bodies, warning: null};
  } catch (error) {
    return {bodies: [], warning: `WARNING: monster body index invalid/ignored: ${error.message}. Falling back to legacy lookup; its window may be incomplete.`};
  }
}
