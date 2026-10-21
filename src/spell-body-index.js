import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const key = value => String(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const integer = value => Number.isSafeInteger(value);

// Optional, source-bound projections: slices contain no substituted rules text.
export const indexedSpellBodies=(lib,names,codes,limit)=>indexedFragmentBodies(lib,names,codes,limit,'spell');
export const indexedItemBodies=(lib,names,codes,limit)=>indexedFragmentBodies(lib,names,codes,limit,'item');

function indexedFragmentBodies(lib, names, requestedCodes, limit, kind) {
 const indexPath=path.join(lib.root,'lookups',`${kind}_body_index.json`);
 if (!fs.existsSync(indexPath)) return {bodies:[],warning:null};
 try {
  const index=JSON.parse(fs.readFileSync(indexPath,'utf8'));
  if(index.schema_version!==1 || !Array.isArray(index.entries) || index.entry_count!==index.entries.length || !index.sources || typeof index.sources!=='object') throw new Error('invalid schema/count');
  const wanted=new Set(names.map(key));
  const books=requestedCodes || [...lib.books.keys()];
  const matches=(e,name)=>key(name)===key(e.name) || (kind==='item' && Array.isArray(e.aliases) && e.aliases.some(alias=>key(name)===key(alias)));
  let candidates=index.entries.filter(e=>e && typeof e.name==='string' && names.some(name=>matches(e,name)) && books.includes(e.book));
  const rank=e=>names.findIndex(name=>matches(e,name));
  const bestRank=Math.min(...candidates.map(rank));
  candidates=candidates.filter(e=>rank(e)===bestRank);
  const identities=new Set();
  for(const e of candidates){const id=e.book+':'+key(e.name);if(identities.has(id))throw new Error(`duplicate ${kind} identity`);identities.add(id);}
  candidates.sort((a,b)=>books.indexOf(a.book)-books.indexOf(b.book));
  const sources=new Map();const bodies=[];
  for(const entry of candidates.slice(0,limit)) {
   const book=lib.books.get(entry.book);const source=index.sources[entry.book];
   if(!book || !source || source.file!==path.relative(lib.root,book.abs) || !/^[a-f0-9]{64}$/.test(source.sha256))throw new Error('invalid registered source');
   if(!sources.has(entry.book)) {
    const raw=fs.readFileSync(book.abs);
    if(createHash('sha256').update(raw).digest('hex')!==source.sha256)throw new Error(`${entry.book} source fingerprint changed`);
    const lines=raw.toString('utf8').split(/\r?\n/);let page=null;const pages=lines.map(line=>{const m=/^## PDF Page (\d+)\s*$/.exec(line);if(m)page=Number(m[1]);return page;});
    sources.set(entry.book,{lines,pages});
   }
   const {lines,pages}=sources.get(entry.book);
   const heading=entry.heading;
   if(!heading || !integer(heading.line) || heading.line<1 || heading.line>lines.length || (heading.pdf_page!==null && !integer(heading.pdf_page)) || pages[heading.line-1]!==heading.pdf_page || !Array.isArray(entry.fragments) || !entry.fragments.length)throw new Error('invalid heading/fragments');
   const occupied=new Map();let includesHeading=false;
   const repairs=new Map();const applied=new Set();
   if(entry.repairs!==undefined && !Array.isArray(entry.repairs))throw new Error('invalid repairs');
   for(const repair of entry.repairs || []){
    const id=`${repair.line}:${repair.column}`;
    if(!integer(repair.line) || !['L','R','S'].includes(repair.column) || typeof repair.before!=='string' || typeof repair.after!=='string' || !repair.after || /[\r\n]/.test(repair.after) || typeof repair.evidence!=='string' || !repair.evidence.trim() || repairs.has(id))throw new Error('invalid/duplicate repair');
    repairs.set(id,repair);
   }
   const sections=[];
   for(const fragment of entry.fragments) {
    if((fragment.pdf_page!==null && !integer(fragment.pdf_page)) || !['L','R','S'].includes(fragment.column) || !Array.isArray(fragment.slices) || !fragment.slices.length)throw new Error('invalid fragment');
    const rows=[];
    for(const slice of fragment.slices) {
     if(!Array.isArray(slice) || slice.length!==3 || !slice.every(integer))throw new Error('invalid slice');
     const [line,start,end]=slice;const chars=Array.from(lines[line-1] || '');
     if(line<1 || line>lines.length || start<0 || end<=start || end>chars.length || pages[line-1]!==fragment.pdf_page || /^\s*(?:```|## PDF Page)/.test(lines[line-1]))throw new Error('slice outside source/page');
     const ranges=occupied.get(line) || [];
     if(ranges.some(([a,b])=>start<b && end>a))throw new Error('overlapping slices');
     ranges.push([start,end]);occupied.set(line,ranges);
     includesHeading ||= line===heading.line;
     let value=chars.slice(start,end).join('');const id=`${line}:${fragment.column}`;const repair=repairs.get(id);
     if(repair){if(repair.before!==value)throw new Error('repair source wording changed');value=repair.after;applied.add(id);}
     rows.push(`${line}${fragment.column} | ${value}`);
    }
    const label=fragment.pdf_page===null ? 'Single-column source' : `PDF page ${fragment.pdf_page}, ${fragment.column==='S' ? 'source stream (physical PDF column not certified)' : `column ${fragment.column}`}`;
    sections.push(`${label}\n${rows.join('\n')}`);
   }
   if(!includesHeading)throw new Error('heading not included');
   if(applied.size!==repairs.size)throw new Error('repair outside indexed body');
   const notes=repairs.size ? `\nreviewed OCR corrections: ${repairs.size} (source-slice wording and evidence validated; original source retained)` : '';
   if(entry.warnings!==undefined && (!Array.isArray(entry.warnings) || entry.warnings.some(w=>typeof w!=='string' || !w.trim())))throw new Error('invalid verification warning');
   const warnings=(entry.warnings || []).map(w=>`\nCAUTION: ${w}`).join('');
   const pageLabel=heading.pdf_page===null ? '' : `, pdf p.${heading.pdf_page}`;
   if(entry.variant_aliases!==undefined && (!Array.isArray(entry.variant_aliases) || entry.variant_aliases.some(alias=>typeof alias!=='string' || !entry.aliases?.includes(alias))))throw new Error('invalid variant aliases');
   const variant=kind==='item' && entry.variant_aliases?.some(alias=>key(names[rank(entry)])===key(alias)) ? '\nCAUTION: Requested item variant: this is the printed base item card with its variant text, not a calculated variant sheet. Apply the named variant explicitly.' : '';
   bodies.push(`### ${book.short || entry.book} ${source.file}:${heading.line}${pageLabel}\nentry: ${entry.name}\nreading_order: indexed ${kind} fragments (source SHA256 verified; full indexed body)${notes}${variant}${warnings}\n\n\x60\x60\x60text\n${sections.join('\n\n')}\n\x60\x60\x60`);
  }
  return {bodies,warning:null};
 }catch(error){return {bodies:[],warning:`WARNING: ${kind} body index invalid/ignored: ${error.message}. Falling back to legacy lookup; its window may be incomplete.`};}
}
