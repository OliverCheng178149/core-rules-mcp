import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {indexedMonsterBodies} from '../src/monster-body-index.js';
const hash = data => createHash('sha256').update(data).digest('hex');
function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'monster-index-'));
 fs.mkdirSync(path.join(root,'lookups','monster_bodies'),{recursive:true});
 const raw='## PDF Page 2\nANCIENT FIXTURE\nArmor Class 22\nHit Points 481\n';
 fs.writeFileSync(path.join(root,'raw.md'),raw);
 const rows=['# Reviewed monster reading cache','## Ancient Fixture','AC 22 | HP 481',...Array.from({length:220},(_,i)=>`Trait ${i}. ${'Long source text. '.repeat(6)}`),'Tail Swipe. Final owned ability.','## Neighbor','Never return adjacent text.'];
 const bodyFile='lookups/monster_bodies/fixture.md';fs.writeFileSync(path.join(root,bodyFile),rows.join('\n'));
 const body={start:2,end:224,sha256:hash(rows.slice(1,224).join('\n'))};
 const index={schema_version:1,entry_count:1,sources:{mm14:{file:'raw.md',sha256:hash(raw),reading_file:bodyFile,reading_sha256:hash(rows.join('\n'))}},entries:[{book:'mm14',name:'Ancient Fixture',complete:true,heading:{line:2,pdf_page:2},body,warnings:['Unresolved source spelling retained.']}]};
 const save=()=>fs.writeFileSync(path.join(root,'lookups/monster_body_index.json'),JSON.stringify(index));save();
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const lib={root,books:new Map([['mm14',{abs:path.join(root,'raw.md'),short:'MM14'}]])};
 const call=(names=['Ancient Fixture'],books=['mm14'],limit=1)=>indexedMonsterBodies(lib,names,books,limit);
 return {root,index,save,call,rows,lib};
}
test('complete indexed monster retains a long terminal ability without line or character truncation',t=>{
 const {call}=fixture(t);const out=call();assert.equal(out.warning,null);assert.equal(out.bodies.length,1);
 assert.ok(out.bodies[0].length>14000);assert.match(out.bodies[0],/Tail Swipe\. Final owned ability/);assert.doesNotMatch(out.bodies[0],/Never return adjacent|## Neighbor/);assert.match(out.bodies[0],/Unresolved source spelling retained/);
});
test('monster identity is exact after punctuation normalization and respects edition filters',t=>{
 const {call}=fixture(t);assert.equal(call(['ANCIENT-FIXTURE']).bodies.length,1);assert.equal(call(['Ancient Fixtures']).bodies.length,0);assert.equal(call(undefined,['mm24']).bodies.length,0);
});
test('changed raw source fails closed rather than serving stale provenance',t=>{
 const {root,call}=fixture(t);fs.appendFileSync(path.join(root,'raw.md'),'changed');const out=call();assert.equal(out.bodies.length,0);assert.match(out.warning,/source fingerprint/);
});
test('changed reading cache fails closed rather than serving edited mechanics',t=>{
 const {root,call}=fixture(t);fs.appendFileSync(path.join(root,'lookups/monster_bodies/fixture.md'),'changed');const out=call();assert.equal(out.bodies.length,0);assert.match(out.warning,/reading fingerprint/);
});
test('invalid registered source path and untrusted reading path are rejected',t=>{
 const {index,save,call}=fixture(t);index.sources.mm14.file='../foreign.md';save();assert.match(call().warning,/registered source/);
 index.sources.mm14.file='raw.md';index.sources.mm14.reading_file='/etc/passwd';save();assert.match(call().warning,/reading path/);
});
test('invalid bounds, body fingerprint and foreign heading cannot silently pass',t=>{
 const {index,save,call}=fixture(t);index.entries[0].body.end=9999;save();assert.match(call().warning,/bounds/);
 index.entries[0].body.end=224;index.entries[0].body.sha256='0'.repeat(64);save();assert.match(call().warning,/body fingerprint/);
 index.entries[0].heading.pdf_page=99;save();assert.match(call().warning,/heading/);
});
test('duplicate identities fail closed; missing optional index preserves legacy',t=>{
 const {root,index,save,call}=fixture(t);index.entries.push(index.entries[0]);index.entry_count=2;save();assert.match(call().warning,/duplicate/);
 fs.unlinkSync(path.join(root,'lookups/monster_body_index.json'));assert.deepEqual(call(),{bodies:[],warning:null});
});

test('a source-bound span cannot be silently rebound to a neighboring identity',t=>{
 const {index,save,call}=fixture(t);index.entries[0].name='Neighbor';save();
 assert.match(call(['Neighbor']).warning,/identity/);
});
test('review-required projections cannot claim a complete card',t=>{
 const {index,save,call}=fixture(t);index.entries[0].complete=false;save();
 const out=call().bodies[0];assert.match(out,/EXTRACTION REVIEW REQUIRED/);assert.doesNotMatch(out,/complete indexed card/);
});

test('public MCP lookup also returns a card beyond the old character/line limits',async t=>{
 const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
 const {StdioClientTransport}=await import('@modelcontextprotocol/sdk/client/stdio.js');
 const {root}=fixture(t);
 const put=(file,data)=>fs.writeFileSync(path.join(root,file),JSON.stringify(data));
 put('extraction_manifest.json',{books:[{code:'mm14',short:'MM14',full_source_file:'raw.md'}]});
 put('pdf_page_map.json',{});put('lookup_catalog.json',[]);put('lookup_aliases.json',{known_variants:{}});
 put('lookups/spell_access_catalog.json',{schema_version:1,edition:'fixture',entry_count:0,entries:{}});
 const client=new Client({name:'long-monster-protocol-test',version:'1.0'});
 await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve('src/index.js')],env:{...process.env,CORE_RULES_PATH:root}}));
 try {
  const result=await client.callTool({name:'lookup_monster',arguments:{name:'Ancient Fixture',books:'mm14',max_results:1,context_lines:0}});
  assert.ok(!result.isError);const text=result.content.map(c=>c.text||'').join('\n');
  assert.ok(text.length>14000);assert.match(text,/Tail Swipe\. Final owned ability/);assert.doesNotMatch(text,/Never return adjacent|\[truncated:/);
 } finally {await client.close();}
});

test('literal monster identity wins over related-creature search hints',t=>{
 const {index,save,call}=fixture(t);
 index.entries.unshift({...index.entries[0],name:'Related Creature'});index.entry_count=2;save();
 const out=call(['Ancient Fixture','Related Creature']);assert.equal(out.warning,null);
 assert.equal(out.bodies.length,1);assert.match(out.bodies[0],/Ancient Fixture/);
});
test('a generated reading symlink cannot escape the generated body tree',t=>{
 const {root,call}=fixture(t);const p=path.join(root,'lookups/monster_bodies/fixture.md');
 const outside=path.join(root,'foreign.md');fs.renameSync(p,outside);fs.symlinkSync(outside,p);
 assert.match(call().warning,/reading symlink/);
});
