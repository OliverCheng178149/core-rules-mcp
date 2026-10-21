import copy,hashlib,importlib.util,json,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('builder',Path(__file__).parents[1]/'scripts/build-monster-body-index.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class BuilderTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.base=self.root/'core';self.base.mkdir(parents=True);self.raw='## PDF Page 2\nFIXTURE\nArmor Class 12\nHit Points 20\nTail. Final effect.\n## PDF Page 3\nNEIGHBOR\n';(self.base/'raw.md').write_text(self.raw);self.layout={'reviewed_on':'2026-10-14','books':{'fixture':{'folder':'core','file':'raw.md','sha256':mod.sha(self.raw.encode()),'entries':[{'name':'Fixture','heading':{'line':2,'pdf_page':2},'slices':[[3,0,14,'L'],[4,0,13,'L'],[5,0,19,'L']],'complete':True,'warnings':[]}]}}}
 def entry(self):return self.layout['books']['fixture']['entries'][0]
 def test_full_tail_and_exact_reproducibility(self):
  outputs=mod.build(self.root,self.layout);text=next(t for p,t in outputs.items() if p.suffix=='.md');self.assertIn('Tail. Final effect.',text);self.assertNotIn('NEIGHBOR',text)
  for p,t in outputs.items():mod.write_in_place(p,t);mod.write_in_place(p,t,check=True)
 def test_complete_body_recovery_requires_primary_pdf_proof(self):
  self.entry()['body_recovery']={'text':'Small construct, unaligned\nArmor Class 12\nHit Points 20\nTail. Final effect.','evidence':{'pdf_page':2,'pdf_sha256':'a'*64,'checked':'original full-card image'}}
  out=mod.build(self.root,self.layout);self.assertIn('Small construct',next(t for p,t in out.items() if p.suffix=='.md'));self.entry()['body_recovery']['evidence']['checked']='';self.assertRaisesRegex(ValueError,'recovered body',mod.build,self.root,self.layout)
 def test_two_distinct_cards_cannot_claim_the_same_source_characters(self):
  other=copy.deepcopy(self.entry());other['name']='Neighbor';other['heading']={'line':7,'pdf_page':3};other['source_pages']=[2,3]
  self.layout['books']['fixture']['entries'].append(other)
  self.assertRaisesRegex(ValueError,'claimed by.*Fixture.*Neighbor',mod.build,self.root,self.layout)
 def test_two_cards_can_use_disjoint_columns_of_one_source_line(self):
  raw='## PDF Page 2\nFIRST\nArmor Class 12           Armor Class 15\nHit Points 20           Hit Points 30\nTail. First end.        Tail. Second end.\nSECOND\n'
  (self.base/'raw.md').write_text(raw);b=self.layout['books']['fixture'];b['sha256']=mod.sha(raw.encode());e=self.entry();e['slices']=[[3,0,14,'L'],[4,0,13,'L'],[5,0,16,'L']]
  other=copy.deepcopy(e);other.update(name='Neighbor',heading={'line':6,'pdf_page':2},slices=[[3,24,38,'R'],[4,24,37,'R'],[5,24,41,'R']]);b['entries'].append(other)
  outputs=mod.build(self.root,self.layout);text=next(t for p,t in outputs.items()if p.suffix=='.md');self.assertIn('Tail. Second end.',text)
 def test_changed_source_requires_review(self):
  (self.base/'raw.md').write_text(self.raw+'changed');self.assertRaisesRegex(ValueError,'source changed',mod.build,self.root,self.layout)
 def test_cross_page_requires_explicit_source_pages(self):
  self.entry()['slices'].append([7,0,8,'L']);self.assertRaisesRegex(ValueError,'cross-page',mod.build,self.root,self.layout)
 def test_bounds_and_overlaps_rejected(self):
  self.entry()['slices'][0][2]=999;self.assertRaisesRegex(ValueError,'bounds',mod.build,self.root,self.layout)
 def test_unexplained_repair_rejected(self):
  self.entry()['repairs']=[{'line':3,'column':'L','before':'Armor Class','after':'AC','evidence':''}];self.assertRaisesRegex(ValueError,'unexplained',mod.build,self.root,self.layout)
 def test_recovered_passage_requires_owned_anchor_and_pdf_proof(self):
  self.entry()['insertions']=[{'before_line':5,'column':'L','text':'Recovered Trait. Complete effect.','evidence':{'pdf_page':2,'pdf_sha256':'a'*64,'checked':'original image'}}];out=mod.build(self.root,self.layout);self.assertIn('Recovered Trait',next(t for p,t in out.items() if p.suffix=='.md'));self.entry()['insertions'][0]['before_line']=999;self.assertRaisesRegex(ValueError,'owned anchor',mod.build,self.root,self.layout)
 def test_structured_spell_templates_are_not_monster_cards(self):
  raw='# Spells\n## Summon Fixture\nAC 15 HP 30\n# Monsters\n## Actual Monster\nAC 12 HP 20\nTail. Final effect.\n';(self.base/'raw.md').write_text(raw);b=self.layout['books']['fixture'];b.update(format='markdown',section='# Monsters',sha256=mod.sha(raw.encode()));outputs=mod.build(self.root,self.layout);i=json.loads(next(t for p,t in outputs.items() if p.suffix=='.json'));self.assertEqual([e['name'] for e in i['entries']],['Actual Monster'])
if __name__=='__main__':unittest.main()
