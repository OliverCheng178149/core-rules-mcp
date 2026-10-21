import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const text = r => r.content.map(c => c.text || '').join('\n');
async function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'spell-index-'));
 fs.mkdirSync(path.join(root,'lookups'));
 const rows=['## PDF Page 1','```text','Right continuation kept.','OTHER SPELL','Unrelated foreign text.','BROKEN SPELL','Level 2 Illusion','Casting Time: Action','Range: Self','Component: V','Duration: 1 minute','Left beginning kept.','```','## PDF Page 2','```text','Final cross-page condition kept.','```'];
 const file='_full_source_fixture.md';fs.writeFileSync(path.join(root,file),rows.join('\n'));
 const json=(p,x)=>fs.writeFileSync(path.join(root,p),JSON.stringify(x));
 json('extraction_manifest.json',{books:[{code:'fixture',short:'FIXTURE',full_source_file:file}]});
 json('pdf_page_map.json',{});json('lookup_catalog.json',[]);json('lookup_aliases.json',{known_variants:{}});
 json('lookups/spell_access_catalog.json',{schema_version:1,edition:'fixture',entry_count:0,entries:{}});
 const slice=(line)=>[line,0,Array.from(rows[line-1]).length];
 const index={schema_version:1,entry_count:1,sources:{fixture:{file,sha256:createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')}},entries:[{book:'fixture',name:'Broken Spell',heading:{line:6,pdf_page:1},fragments:[{pdf_page:1,column:'L',slices:[6,7,8,9,10,11,12].map(slice)},{pdf_page:1,column:'R',slices:[slice(3)]},{pdf_page:2,column:'L',slices:[slice(16)]}]}]};
 json('lookups/spell_body_index.json',index);
 const client=new Client({name:'indexed-spell-test',version:'1.0'});
 await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve('src/index.js')],env:{...process.env,CORE_RULES_PATH:root}}));
 t.after(async()=>{await client.close();fs.rmSync(root,{recursive:true,force:true});});
 return {root,index,json,rows,call:args=>client.callTool({name:'lookup_spell',arguments:{name:'Broken Spell',books:'fixture',...args}})};
}
test('indexed spell joins a backward column and next page without adjacent spells',async t=>{
 const {call}=await fixture(t);const out=text(await call({context_lines:0}));
 assert.match(out,/reading_order: indexed spell fragments/);
 assert.ok(out.indexOf('Left beginning kept.')<out.indexOf('Right continuation kept.'));
 assert.ok(out.indexOf('Right continuation kept.')<out.indexOf('Final cross-page condition kept.'));
 assert.doesNotMatch(out,/Unrelated foreign text|OTHER SPELL/);
 assert.match(out,/3R \|/);assert.match(out,/PDF page 2/);
});
test('index lookup tolerates input punctuation and case without fuzzy identity substitution',async t=>{
 const {call}=await fixture(t);assert.match(text(await call({name:'BROKEN-SPELL'})),/indexed spell fragments/);
 assert.doesNotMatch(text(await call({name:'Broken Bells'})),/indexed spell fragments/);
});
test('a changed source invalidates the index rather than applying stale coordinates',async t=>{
 const {call,root}=await fixture(t);fs.appendFileSync(path.join(root,'_full_source_fixture.md'),'\nchanged');
 const out=text(await call({}));assert.match(out,/spell body index.*(invalid|unavailable|ignored)/i);assert.doesNotMatch(out,/reading_order: indexed spell fragments/);
});
test('out-of-bounds indexed slices fail closed with a visible warning',async t=>{
 const {call,index,json}=await fixture(t);index.entries[0].fragments[0].slices[0]=[6,0,9999];json('lookups/spell_body_index.json',index);
 const out=text(await call({}));assert.match(out,/spell body index.*(invalid|unavailable|ignored)/i);assert.doesNotMatch(out,/reading_order: indexed spell fragments/);
});
test('wrong PDF page provenance fails closed',async t=>{
 const {call,index,json}=await fixture(t);index.entries[0].fragments[2].pdf_page=99;json('lookups/spell_body_index.json',index);
 const out=text(await call({}));assert.match(out,/spell body index.*(invalid|unavailable|ignored)/i);assert.doesNotMatch(out,/reading_order: indexed spell fragments/);
});
test('missing optional index keeps legacy lookup working without an index warning',async t=>{
 const {call,root}=await fixture(t);fs.unlinkSync(path.join(root,'lookups/spell_body_index.json'));
 const out=text(await call({}));assert.doesNotMatch(out,/spell body index.*(invalid|unavailable|ignored)/i);
});

test('reviewed OCR corrections use the exact source slice and carry their evidence',async t=>{
 const {call,index,json}=await fixture(t);
 index.entries[0].repairs=[{line:11,column:'L',before:'Duration: 1 minute',after:'Duration: 1 minute (verified)',evidence:'Fixture PDF page 1 inspected.'}];
 json('lookups/spell_body_index.json',index);
 const out=text(await call({}));
 assert.match(out,/11L \| Duration: 1 minute \(verified\)/);
 assert.match(out,/reviewed OCR corrections: 1/);
});

test('a correction with stale source wording fails closed rather than rewriting a different row',async t=>{
 const {call,index,json}=await fixture(t);
 index.entries[0].repairs=[{line:11,column:'L',before:'Duration: 7 minutes',after:'Duration: 1 minute',evidence:'Fixture PDF page 1 inspected.'}];
 json('lookups/spell_body_index.json',index);
 const out=text(await call({}));
 assert.match(out,/spell body index.*(invalid|ignored)/i);
 assert.doesNotMatch(out,/reading_order: indexed spell fragments/);
});

test('only the literal spell is returned when catalog hints also name a different spell',async t=>{
 const {call,index,json,rows}=await fixture(t);
 json('lookup_aliases.json',{known_variants:{'Broken Spell':['Other Spell']}});
 index.entries.push({book:'fixture',name:'Other Spell',heading:{line:4,pdf_page:1},fragments:[{pdf_page:1,column:'L',slices:[[4,0,rows[3].length],[5,0,rows[4].length]]}]});index.entry_count++;
 json('lookups/spell_body_index.json',index);
 const out=text(await call({max_results:8}));
 assert.match(out,/BROKEN SPELL/);assert.doesNotMatch(out,/Unrelated foreign text|OTHER SPELL/);
});

test('single-column structured source returns its full long spell without an invented PDF page',async t=>{
 const {call,index,json,root}=await fixture(t);
 const rows=['## Broken Spell','Casting Time: Action','Range: Self','Components: V','Duration: 1 minute',...Array.from({length:220},(_,i)=>`Source row ${i}: ${'bounded original text '.repeat(5)}`),'The final source condition is retained.'];
 const raw=rows.join('\n');fs.writeFileSync(path.join(root,'_full_source_fixture.md'),raw);
 index.sources.fixture.sha256=createHash('sha256').update(raw).digest('hex');
 index.entries[0]={book:'fixture',name:'Broken Spell',heading:{line:1,pdf_page:null},fragments:[{pdf_page:null,column:'S',slices:rows.map((row,i)=>[i+1,0,row.length])}]};
 json('lookups/spell_body_index.json',index);
 const out=text(await call({}));
 assert.match(out,/indexed spell fragments/);assert.match(out,/final source condition is retained/);
 assert.doesNotMatch(out,/\[truncated:|pdf p.null|PDF page null/);
});

test('reviewed-index builder refuses changed cache bytes instead of refreshing their hash',async()=>{
 const {execFileSync}=await import('node:child_process');
 const program=`import importlib.util,tempfile,pathlib,hashlib\nspec=importlib.util.spec_from_file_location('builder','scripts/build-spell-body-index.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nwith tempfile.TemporaryDirectory() as d:\n root=pathlib.Path(d);base=root/'fixture';base.mkdir(parents=True);(base/'lookups').mkdir();p=base/'_full_source_fixture.md';p.write_text('## PDF Page 1\\nFixture Spell\\n')\n layout={'reviewed_on':'test','books':{'fixture':{'folder':'fixture','file':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'pages':{'1':50},'headings':[{'name':'Fixture Spell','line':2,'column':'L','pdf_page':1}],'exclude':[],'attachments':[]}}}\n assert len(m.build(root,layout))==1\n p.write_text('changed source')\n try:m.build(root,layout)\n except ValueError as e:assert 'source changed' in str(e)\n else:raise AssertionError('stale layout was accepted')\n`;
 execFileSync('python3',['-B','-c',program],{cwd:process.cwd()});
});
