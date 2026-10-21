import hashlib,importlib.util,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('builder',Path(__file__).resolve().parents[1]/'scripts/build-spell-body-index.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class SpellBuilderTests(unittest.TestCase):
 def fixture(self,root):
  base=root/'fixture';base.mkdir(parents=True)
  rows=['## PDF Page 1','SPELL ONE','Casting Time: 1 action','Damage: ld6','Tiny 4  18    Foreign text','              SPELL TWO','              Casting Time: 1 action']
  p=base/'_full_source_fixture.md';p.write_text('\n'.join(rows))
  b={'folder':'fixture','file':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'pages':{'1':9},'headings':[{'name':'Spell One','line':2,'column':'L','pdf_page':1},{'name':'Spell Two','line':6,'column':'R','pdf_page':1}],'exclude':[],'attachments':[]}
  return base,rows,{'reviewed_on':'test','books':{'fixture':b}},b

 def test_table_final_column_stays_with_its_spell(self):
  with tempfile.TemporaryDirectory() as d:
   base,rows,layout,b=self.fixture(Path(d));b['cell_overrides']=[{'line':5,'slices':[[0,10,'L'],[14,len(rows[4]),'R']]}]
   index=next(iter(m.build(Path(d),layout).values()))
   own=index['entries'][0];slices=[s for f in own['fragments'] if f['column']=='L' for s in f['slices'] if s[0]==5]
   self.assertEqual(slices,[[5,0,10]])

 def test_verified_row_correction_survives_regeneration(self):
  with tempfile.TemporaryDirectory() as d:
   base,rows,layout,b=self.fixture(Path(d));b['repairs']={'Spell One':[{'line':4,'column':'L','before':'Damage: ld6','after':'Damage: 1d6','evidence':'Original fixture page 1.'}]}
   index=next(iter(m.build(Path(d),layout).values()))
   self.assertEqual(index['entries'][0]['repairs'][0]['after'],'Damage: 1d6')

 def test_overlapping_override_is_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   base,rows,layout,b=self.fixture(Path(d));b['cell_overrides']=[{'line':5,'slices':[[0,10,'L'],[8,len(rows[4]),'R']]}]
   with self.assertRaisesRegex(ValueError,'overlap'):m.build(Path(d),layout)

 def test_plain_cache_stream_does_not_claim_a_physical_pdf_column(self):
  with tempfile.TemporaryDirectory() as d:
   base,rows,layout,b=self.fixture(Path(d));b['single_column']=True
   for h in b['headings']:h['column']='S'
   index=next(iter(m.build(Path(d),layout).values()))
   self.assertTrue(all(f['column']=='S' for e in index['entries'] for f in e['fragments']))

 def test_intra_table_spacing_is_not_a_page_gutter(self):
  rows=[(1,'            STR   DEX   CON'),(2,'STR DEX CON    INT WIS CHA')]
  right=m.cells_for_page(rows[:1],10,1)
  self.assertEqual([(c['column'],c['start'],c['end']) for c in right],[('R',12,27)])
  left=m.cells_for_page(rows[1:],30,1)
  self.assertEqual([(c['column'],c['start'],c['end']) for c in left],[('L',0,26)])

 def test_explicit_section_end_does_not_append_an_unrelated_chapter(self):
  with tempfile.TemporaryDirectory() as d:
   base,rows,layout,b=self.fixture(Path(d));b['headings'][0]['stop']={'line':5,'column':'L'}
   index=next(iter(m.build(Path(d),layout).values()))
   self.assertNotIn(5,[s[0] for f in index['entries'][0]['fragments'] for s in f['slices']])

 def test_wide_table_page_keeps_rows_together_without_changing_the_next_page(self):
  with tempfile.TemporaryDirectory() as d:
   base,rows,layout,b=self.fixture(Path(d));rows+=['## PDF Page 2','NEXT ENTRY','Casting Time: 1 action']
   p=base/b['file'];p.write_text('\n'.join(rows));b['sha256']=hashlib.sha256(p.read_bytes()).hexdigest();b['pages']['2']=9;b['single_stream_pages']=[1]
   b['headings']=[{'name':'Spell One','line':2,'column':'S','pdf_page':1},{'name':'Next Entry','line':9,'column':'L','pdf_page':2}]
   index=next(iter(m.build(Path(d),layout).values()))
   self.assertEqual([f['column'] for f in index['entries'][0]['fragments']],['S'])
   self.assertEqual([f['column'] for f in index['entries'][1]['fragments']],['L'])

 def test_cell_override_does_not_reintroduce_an_excluded_neighbor(self):
  with tempfile.TemporaryDirectory() as d:
   base,rows,layout,b=self.fixture(Path(d));b['cell_overrides']=[{'line':5,'slices':[[0,10,'L'],[14,len(rows[4]),'R']]}];b['exclude']=[[5,'R']]
   index=next(iter(m.build(Path(d),layout).values()))
   self.assertNotIn((5,'R'),[(s[0],f['column']) for e in index['entries'] for f in e['fragments'] for s in f['slices']])

 def test_explicit_reading_order_preserves_every_owned_cell_once(self):
  with tempfile.TemporaryDirectory() as d:
   base,rows,layout,b=self.fixture(Path(d));b['headings'][0]['stop']={'line':5,'column':'L'};b['reading_orders']={'Spell One':[[2,'L'],[4,'L'],[3,'L']]}
   index=next(iter(m.build(Path(d),layout).values()))
   self.assertEqual([s[0] for f in index['entries'][0]['fragments'] for s in f['slices']],[2,4,3])
   b['reading_orders']['Spell One']=[[2,'L'],[4,'L']]
   with self.assertRaisesRegex(ValueError,'reading order'):m.build(Path(d),layout)

if __name__=='__main__':unittest.main()
