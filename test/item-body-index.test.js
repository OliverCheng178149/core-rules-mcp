import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const text=r=>r.content.map(c=>c.text||'').join('\n');
async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'item-body-'));fs.mkdirSync(path.join(root,'lookups'));
 const rows=['## PDF Page 1','```text','Second-column ending: the charge cost table is retained.','FOREIGN RING','Foreign ring powers must not leak.','REVIEWED STAFF','Staff, Legendary (Requires Attunement)',...Array.from({length:220},(_,i)=>`Staff source paragraph ${i}: ${'original bounded item text '.repeat(4)}`),'## PDF Page 2','Final cross-page drawback retained.','```'];
 const file='_full_source_fixture.md';const raw=rows.join('\n');fs.writeFileSync(path.join(root,file),raw);
 const json=(p,x)=>fs.writeFileSync(path.join(root,p),JSON.stringify(x));
 json('extraction_manifest.json',{books:[{code:'fixture',short:'FIXTURE',full_source_file:file}]});json('pdf_page_map.json',{});json('lookup_catalog.json',[]);json('lookup_aliases.json',{known_variants:{}});json('lookups/spell_access_catalog.json',{schema_version:1,edition:'fixture',entry_count:0,entries:{}});
 const slice=n=>[n,0,rows[n-1].length];
 const index={schema_version:1,entry_count:1,sources:{fixture:{file,sha256:createHash('sha256').update(raw).digest('hex')}},entries:[{book:'fixture',name:'Reviewed Staff',aliases:['Reviewed Staff +1'],variant_aliases:['Reviewed Staff +1'],heading:{line:6,pdf_page:1},fragments:[{pdf_page:1,column:'L',slices:Array.from({length:222},(_,i)=>slice(i+6))},{pdf_page:1,column:'R',slices:[slice(3)]},{pdf_page:2,column:'L',slices:[slice(229)]}]}]};
 json('lookups/item_body_index.json',index);
 const client=new Client({name:'item-body-test',version:'1.0'});await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve('src/index.js')],env:{...process.env,CORE_RULES_PATH:root}}));
 t.after(async()=>{await client.close();fs.rmSync(root,{recursive:true,force:true});});
 return {root,index,json,call:args=>client.callTool({name:'lookup_item',arguments:{name:'Reviewed Staff',books:'fixture',max_results:1,context_lines:0,...args}})};
}
test('item lookup returns all columns and pages without either legacy length cap or adjacent powers',async t=>{
 const {call}=await fixture(t);const out=text(await call({}));assert.match(out,/indexed item fragments/);assert.match(out,/Staff source paragraph 219/);assert.match(out,/charge cost table is retained/);assert.match(out,/Final cross-page drawback retained/);assert.doesNotMatch(out,/Foreign ring powers|\[truncated:/);
});
test('a changed source invalidates the whole-item projection visibly',async t=>{
 const {call,root}=await fixture(t);fs.appendFileSync(path.join(root,'_full_source_fixture.md'),'\nchanged');const out=text(await call({}));assert.match(out,/item body index.*(invalid|ignored)/i);assert.doesNotMatch(out,/reading_order: indexed item fragments/);
});
test('an item variant alias returns the printed base card with an explicit variant caveat',async t=>{
 const {call,json}=await fixture(t);json('lookup_aliases.json',{known_variants:{'Reviewed Staff +1':['Reviewed Staff']}});const out=text(await call({name:'Reviewed Staff +1'}));assert.match(out,/indexed item fragments/);assert.match(out,/variant.*base.*card/i);assert.match(out,/Final cross-page drawback retained/);
});
test('a translated base-item name is not mislabeled as a numerical variant',async t=>{
 const {call,json}=await fixture(t);json('lookup_aliases.json',{known_variants:{'魔法法杖':['Reviewed Staff']}});const out=text(await call({name:'魔法法杖'}));assert.match(out,/indexed item fragments/);assert.doesNotMatch(out,/Requested item variant/);
});
test('a printed nickname resolves the whole item without a variant warning',async t=>{
 const {call,index,json}=await fixture(t);index.entries[0].aliases.push('Scholars Staff');json('lookups/item_body_index.json',index);const out=text(await call({name:'Scholars Staff'}));assert.match(out,/indexed item fragments/);assert.doesNotMatch(out,/Requested item variant/);
});

test('FTD items prefer the registered complete original-PDF card over a partial mechanics cache',async t=>{
 const {call,root,index,json}=await fixture(t);
 const raw=fs.readFileSync(path.join(root,'_full_source_fixture.md'));
 fs.writeFileSync(path.join(root,'ftd-full.md'),raw);
 json('extraction_manifest.json',{books:[{code:'ftd',short:'FTD',full_source_file:'_full_source_fixture.md'},{code:'ftd_full',short:'FTD full',full_source_file:'ftd-full.md'}]});
 index.sources.ftd_full={...index.sources.fixture,file:'ftd-full.md'};delete index.sources.fixture;index.entries[0].book='ftd_full';json('lookups/item_body_index.json',index);
 const out=text(await call({books:'ftd'}));assert.match(out,/indexed item fragments/);assert.match(out,/Final cross-page drawback retained/);
});

test('unindexed item queries visibly distinguish legacy windows from complete cards',async t=>{
 const {call}=await fixture(t);const out=text(await call({name:'Foreign Ring'}));assert.match(out,/No reviewed complete-item index matched/);assert.doesNotMatch(out,/reading_order: indexed item fragments/);
});
