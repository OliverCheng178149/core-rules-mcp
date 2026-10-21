#!/usr/bin/env python3
"""Build source-bound entry projections; never synthesize rules or errata.
Usage: python3 scripts/build-spell-body-index.py --sources-root DIR --layout LAYOUT.json [--kind spell|item] [--check]
Each layout book names a library folder relative to --sources-root. The layout
is your own review of your own caches and is tied to their exact hashes; a
changed input requires a new review. No layout ships with this repository.
Local OCR repairs retain exact before text and primary-source evidence.
"""
import argparse,hashlib,json,os,re
from pathlib import Path

def cells_for_page(rows,gutter,page):
 cells=[]
 for ln,t in rows:
  if not t.strip() or t.startswith('```'):continue
  runs=[]
  indent=len(t)-len(t.lstrip());right_edge=len(t.rstrip())
  # Do not mistake whitespace between ability/table columns for the page's
  # gutter when the entire row is already on one side of that gutter.
  for m in ([] if indent>=gutter or right_edge<=gutter else re.finditer(r' {2,}',t)):
   if t[:m.start()].strip() and t[m.end():].strip():
    dist=max(m.start()-gutter,gutter-m.end(),0)
    if dist<12:runs.append((dist,m))
  if runs:
   _,m=min(runs,key=lambda x:x[0]);parts=[('L',0,m.start()),('R',m.end(),len(t))]
  else:
   parts=[('R' if len(t)-len(t.lstrip())>=gutter else 'L',0,len(t))]
  for col,a,b in parts:
   while a<b and t[a].isspace():a+=1
   while b>a and t[b-1].isspace():b-=1
   if a<b and re.search(r'[A-Za-z0-9]',t[a:b]):cells.append({'line':ln,'start':a,'end':b,'column':col,'pdf_page':page})
 return sorted(cells,key=lambda c:(c['column']=='R',c['line']))

def build(root,layout):
 outputs={}
 for code,book in layout['books'].items():
  base=root/book['folder'];source=base/book['file'];raw=source.read_bytes()
  if hashlib.sha256(raw).hexdigest()!=book['sha256']:raise ValueError(f'{code}: source changed; review layout before rebuilding')
  lines=raw.decode().splitlines();page=None;rows={}
  index_base=root/book.get('index_folder',book['folder'])
  dest=index_base/'lookups'/f'{layout.get("kind","spell")}_body_index.json'
  if book.get('format')=='markdown':
   index=outputs.setdefault(dest,{'schema_version':1,'entry_count':0,'reviewed_on':layout['reviewed_on'],'sources':{},'entries':[]})
   index['sources'][code]={'file':os.path.relpath(source,index_base),'sha256':book['sha256']}
   lo=next((i+1 for i,t in enumerate(lines) if t==book.get('section')),1) if book.get('section') else 1
   hi=next((i for i,t in enumerate(lines[lo:],lo) if t.startswith('# ')),len(lines)) if book.get('section') else len(lines)
   heads=[(i+1,t[3:].strip()) for i,t in enumerate(lines) if lo<=i<hi and t.startswith('## ')]
   for j,(ln,name) in enumerate(heads):
    end=heads[j+1][0]-1 if j+1<len(heads) else hi
    slices=[[i+1,0,len(lines[i])] for i in range(ln-1,end) if lines[i].strip() and lines[i].strip()!='---']
    entry={'book':code,'name':name,'heading':{'line':ln,'pdf_page':None},'fragments':[{'pdf_page':None,'column':'S','slices':slices}]}
    if book.get('aliases',{}).get(name):entry['aliases']=book['aliases'][name]
    if book.get('variant_aliases',{}).get(name):entry['variant_aliases']=book['variant_aliases'][name]
    if book.get('warnings',{}).get(name):entry['warnings']=book['warnings'][name]
    index['entries'].append(entry)
   continue
  for i,t in enumerate(lines,1):
   m=re.fullmatch(r'## PDF Page (\d+)\s*',t)
   if m:page=int(m[1]);rows[page]=[]
   elif page is not None:rows[page].append((i,t))
  cells=[]
  excluded={tuple(x) for x in book['exclude']}
  for pg,g in book['pages'].items():
   stream=book.get('single_column') or int(pg) in book.get('single_stream_pages',[])
   candidates=([{'line':ln,'start':len(t)-len(t.lstrip()),'end':len(t.rstrip()),'column':'S','pdf_page':int(pg)} for ln,t in rows[int(pg)] if t.strip() and not t.startswith('```') and not t.startswith('<!--')] if stream else cells_for_page(rows[int(pg)],g,int(pg)))
   cells.extend(c for c in candidates if (c['line'],c['column']) not in excluded and book.get('start_line',1)<=c['line']<=book.get('end_line',len(lines)))
  for override in book.get('cell_overrides',[]):
   ln=override['line'];selected=[c for c in cells if c['line']==ln]
   if not selected:raise ValueError(f'{code}: override outside selected pages')
   pg=selected[0]['pdf_page'];replacements=[];ranges=[]
   for a,b,col in override['slices']:
    if col not in ['L','R','S'] or not 0<=a<b<=len(lines[ln-1]):raise ValueError('invalid cell override')
    if any(a<bb and b>aa for aa,bb in ranges):raise ValueError('overlapping cell override')
    ranges.append((a,b));replacements.append({'line':ln,'start':a,'end':b,'column':col,'pdf_page':pg})
   cells=[c for c in cells if c['line']!=ln]+[c for c in replacements if (c['line'],c['column']) not in excluded]
  cells.sort(key=lambda c:(c['pdf_page'],c['column']=='R',c['line']))
  positions={(c['line'],c['column']):i for i,c in enumerate(cells)}
  if len(positions)!=len(cells):raise ValueError('duplicate source cell')
  heads=sorted(book['headings'],key=lambda h:positions[h['line'],h['column']])
  owned={}
  for i,h in enumerate(heads):
   a=positions[h['line'],h['column']];b=positions[heads[i+1]['line'],heads[i+1]['column']] if i+1<len(heads) else len(cells)
   if h.get('stop'):
    end=positions[h['stop']['line'],h['stop']['column']]
    if not a<end<=b:raise ValueError(f'{code} {h["name"]}: stop outside owned interval')
    b=end
   owned[h['name']]=cells[a:b]
  for rule in book['attachments']:
   selected=[c for c in cells if c['pdf_page']==rule['pdf_page'] and c['column']==rule['column'] and rule['line_start']<=c['line']<=rule['line_end']]
   if not selected:raise ValueError(f'{code}: empty attachment {rule}')
   keys={(c['line'],c['column']) for c in selected}
   for name in owned:owned[name]=[c for c in owned[name] if (c['line'],c['column']) not in keys]
   owned[rule['name']].extend(selected)
  index=outputs.setdefault(dest,{'schema_version':1,'entry_count':0,'reviewed_on':layout['reviewed_on'],'sources':{},'entries':[]})
  index['sources'][code]={'file':os.path.relpath(source,index_base),'sha256':book['sha256']}
  for h in heads:
   cs=sorted(owned[h['name']],key=lambda c:(c['pdf_page'],c['column']=='R',c['line']))
   order=book.get('reading_orders',{}).get(h['name'])
   if order is not None:
    bykey={(c['line'],c['column']):c for c in cs};keys=[tuple(x) for x in order]
    if len(keys)!=len(set(keys)) or set(keys)!=set(bykey):raise ValueError('invalid reading order: must preserve every owned cell once')
    cs=[bykey[k] for k in keys]
   if not cs or not any(c['line']==h['line'] and c['column']==h['column'] for c in cs):raise ValueError('lost heading')
   fragments=[]
   for c in cs:
    if not fragments or (fragments[-1]['pdf_page'],fragments[-1]['column'])!=(c['pdf_page'],c['column']):fragments.append({'pdf_page':c['pdf_page'],'column':c['column'],'slices':[]})
    fragments[-1]['slices'].append([c['line'],c['start'],c['end']])
   entry={'book':code,'name':h['name'],'heading':{'line':h['line'],'pdf_page':h['pdf_page']},'fragments':fragments}
   if h.get('aliases'):entry['aliases']=h['aliases']
   if h.get('variant_aliases'):entry['variant_aliases']=h['variant_aliases']
   warnings=book.get('warnings',{}).get(h['name'],[])
   if warnings:entry['warnings']=warnings
   repairs=book.get('repairs',{}).get(h['name'],[])
   if repairs:
    bykey={(c['line'],c['column']):lines[c['line']-1][c['start']:c['end']] for c in cs};seen=set()
    for r in repairs:
     k=(r['line'],r['column'])
     if k in seen or bykey.get(k)!=r['before'] or not r.get('evidence') or not r.get('after') or '\n' in r['after']:raise ValueError(f'{code} {h["name"]}: invalid/stale repair')
     seen.add(k)
    entry['repairs']=repairs
   index['entries'].append(entry)
 for index in outputs.values():index['entry_count']=len(index['entries'])
 return outputs

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--sources-root',type=Path,required=True);ap.add_argument('--layout',type=Path,required=True);ap.add_argument('--check',action='store_true');ap.add_argument('--kind',choices=['spell','item'],default='spell');args=ap.parse_args()
 layout=json.loads(args.layout.read_text())
 if layout.get('kind','spell')!=args.kind:raise SystemExit(f'FAIL: layout kind {layout.get("kind","spell")!r} does not match --kind {args.kind}')
 for dest,index in build(args.sources_root,layout).items():
  data=json.dumps(index,ensure_ascii=False,separators=(',',':'))+'\n'
  if args.check:
   if not dest.exists() or dest.read_text()!=data:raise SystemExit(f'FAIL: stale generated index {dest}')
  else:dest.write_text(data)
  print(('PASS' if args.check else 'WROTE'),dest,index['entry_count'],'entries')
if __name__=='__main__':main()
