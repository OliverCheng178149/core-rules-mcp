#!/usr/bin/env python3
"""Build fingerprinted complete-card projections from reviewed source coordinates.

No downloaded transcription is substituted for book text. Rebuilding requires the
exact reviewed cache bytes; changing a cache requires a new layout review.

Usage: python3 scripts/build-monster-body-index.py --sources-root DIR --layout LAYOUT.json [--check]
Each layout book names a library folder relative to --sources-root. No layout
ships with this repository.
"""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_in_place(path, data, check=False):
    encoded = data.encode('utf-8')
    if check:
        if not path.exists() or path.read_bytes() != encoded:
            raise ValueError(f'stale generated file: {path}')
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    # Synced folders (iCloud and similar) can turn a rename into a delayed
    # conflict copy, so keep the existing file identity and rewrite in place.
    with path.open('r+b' if path.exists() else 'xb') as stream:
        stream.write(encoded)
        stream.truncate()
        stream.flush()
        os.fsync(stream.fileno())


def build(root, layout):
    outputs = {}
    indices = {}
    for code, book in layout['books'].items():
        base = root / book['folder']
        source = base / book['file']
        raw = source.read_bytes()
        if sha(raw) != book['sha256']:
            raise ValueError(f'{code}: source changed; review layout before rebuilding')
        lines = raw.decode('utf-8').splitlines()
        index_root = root / book.get('index_folder', book['folder'])
        index = indices.setdefault(index_root, {'schema_version': 1, 'entry_count': 0,
                                  'reviewed_on': layout['reviewed_on'], 'sources': {}, 'entries': []})
        source_rel = os.path.relpath(source, index_root)
        if book.get('format') == 'markdown':
            reading_file = source_rel
            reading_raw = raw
            reading_lines = lines
            cards = []
            headings = [(i, re.sub(r'^##\s+', '', t).strip()) for i, t in enumerate(lines)
                        if t.startswith('## ')]
            section_start, section_end = 0, len(lines)
            if book.get('section'):
                section_start = lines.index(book['section'])
                section_end = next((i for i in range(section_start+1, len(lines)) if lines[i].startswith('# ')), len(lines))
            for n, (start, name) in enumerate(headings):
                if not section_start <= start < section_end:
                    continue
                end = headings[n+1][0] if n+1 < len(headings) else len(lines)
                for i in range(start+1, end):
                    if lines[i].startswith('# '):
                        end = i
                        break
                body = '\n'.join(lines[start:end])
                if not (re.search(r'\bAC\b\**\s*:?\s*\d', body)
                        and re.search(r'\bHP\b\**\s*:?\s*\d', body)):
                    continue
                while end > start and not lines[end-1].strip():
                    end -= 1
                aliases = []
                match = re.search(r'^\*\*Aliases:\*\*\s*(.+)$', body, re.M)
                if match:
                    aliases = [x.strip() for x in match[1].split(';') if x.strip()]
                cards.append({'name': name, 'aliases': aliases,
                              'heading': {'line': start+1, 'pdf_page': None},
                              'bounds': [start+1, end], 'complete': True,
                              'warnings': book.get('warnings', [])})
        else:
            reading_file = f'lookups/monster_bodies/{code}.md'
            reading_lines = [f'# {code.upper()} — Source-bound Monster Reading Projections', '',
                             'Private, on-demand reference. Source coordinates and OCR caveats are recorded in monster_body_index.json.',
                             'Layout repair preserves book wording; it is not a rules conversion or a blanket numeric certification.', '']
            cards = []
            page_map = []
            page = None
            for t in lines:
                match = re.fullmatch(r'## PDF Page (\d+)\s*', t)
                if match:
                    page = int(match[1])
                page_map.append(page)
            source_owners = {}
            for entry in book['entries']:
                heading = entry['heading']
                if page_map[heading['line']-1] != heading['pdf_page']:
                    raise ValueError(f'{code}/{entry["name"]}: invalid heading page')
                start = len(reading_lines)+1
                reading_lines.append('## '+entry['name'])
                reading_lines.append(f'<!-- raw source: {book["file"]}:{heading["line"]}; PDF page {heading["pdf_page"]} -->')
                recovered_body = entry.get('body_recovery')
                if recovered_body:
                    evidence = recovered_body.get('evidence', {})
                    if evidence.get('pdf_page') != heading['pdf_page'] or not re.fullmatch(r'[a-f0-9]{64}', evidence.get('pdf_sha256', '')) or not evidence.get('checked') or not recovered_body.get('text'):
                        raise ValueError('unverified recovered body')
                    reading_lines.extend(recovered_body['text'].splitlines())
                    end = len(reading_lines)
                    reading_lines.append('')
                    cards.append({**entry, 'bounds': [start, end]})
                    continue
                recovery = entry.get('recovered_header')
                if recovery:
                    evidence = recovery.get('evidence', {})
                    if evidence.get('pdf_page') != heading['pdf_page'] or not re.fullmatch(r'[a-f0-9]{64}', evidence.get('pdf_sha256', '')) or not evidence.get('checked'):
                        raise ValueError('unverified recovered header')
                    reading_lines.extend(recovery['text'].splitlines())
                occupied = {}
                emitted_insertions = set()
                for line, a, b, column in entry['slices']:
                    if not all(isinstance(v, int) for v in [line, a, b]) or not 1 <= line <= len(lines):
                        raise ValueError('invalid slice line')
                    text = lines[line-1]
                    if not 0 <= a < b <= len(text) or column not in ['L', 'R', 'S']:
                        raise ValueError('invalid slice bounds/column')
                    if page_map[line-1] not in entry.get('source_pages', [heading['pdf_page']]):
                        raise ValueError('unreviewed cross-page slice')
                    if text.lstrip().startswith('```') or re.match(r'^## PDF Page', text):
                        raise ValueError('non-body source slice')
                    for left, right, owner in source_owners.get(line, []):
                        if a < right and b > left and owner != entry['name']:
                            raise ValueError(f'{code}: source line {line} claimed by {owner} and {entry["name"]}')
                    source_owners.setdefault(line, []).append((a, b, entry['name']))
                    ranges = occupied.setdefault(line, [])
                    if any(a < z and b > x for x, z in ranges):
                        raise ValueError('overlapping source slices')
                    ranges.append((a, b))
                    for n, insertion in enumerate(entry.get('insertions', [])):
                        if insertion['before_line'] == line and insertion['column'] == column:
                            evidence = insertion.get('evidence', {})
                            if n in emitted_insertions or evidence.get('pdf_page') != page_map[line-1] or not re.fullmatch(r'[a-f0-9]{64}', evidence.get('pdf_sha256', '')) or not evidence.get('checked') or not insertion.get('text'):
                                raise ValueError('unverified/duplicate recovered passage')
                            reading_lines.extend(insertion['text'].splitlines())
                            emitted_insertions.add(n)
                    value = text[a:b]
                    for repair in entry.get('repairs', []):
                        if repair['line'] == line and repair['column'] == column:
                            if repair['before'] not in value or not repair.get('evidence'):
                                raise ValueError('invalid/unexplained repair')
                            value = value.replace(repair['before'], repair['after'])
                    reading_lines.extend(value.strip().splitlines())
                if len(emitted_insertions) != len(entry.get('insertions', [])):
                    raise ValueError('recovered passage has no owned anchor')
                end = len(reading_lines)
                reading_lines.append('')
                cards.append({**entry, 'bounds': [start, end]})
            reading_raw = ('\n'.join(reading_lines).rstrip()+'\n').encode('utf-8')
            outputs[index_root / reading_file] = reading_raw.decode('utf-8')
            reading_lines = reading_raw.decode('utf-8').splitlines()
        index['sources'][code] = {'file': source_rel, 'sha256': sha(raw),
                                 'reading_file': reading_file, 'reading_sha256': sha(reading_raw)}
        for card in cards:
            start, end = card['bounds']
            body = '\n'.join(reading_lines[start-1:end])
            index['entries'].append({'book': code, 'name': card['name'],
                                     'aliases': card.get('aliases', []), 'heading': card['heading'],
                                     'body': {'start': start, 'end': end, 'sha256': sha(body.encode())},
                                     'complete': card['complete'], 'warnings': card['warnings'],
                                     'repairs': card.get('repairs', []),
                                     'recovered_header': card.get('recovered_header'),
                                     'body_recovery_evidence': card.get('body_recovery', {}).get('evidence'),
                                     'insertions': card.get('insertions', []),
                                     'source_pages': card.get('source_pages', []),
                                     'verification_notes': card.get('verification_notes', []),
                                     'variant_notes': card.get('variant_notes', [])})
    for base, index in indices.items():
        index['entry_count'] = len(index['entries'])
        identities = [(e['book'], re.sub(r'[^a-z0-9]', '', e['name'].casefold())) for e in index['entries']]
        if len(set(identities)) != len(identities):
            raise ValueError('duplicate monster identities')
        outputs[base / 'lookups/monster_body_index.json'] = json.dumps(index, ensure_ascii=False, separators=(',', ':'))+'\n'
    return outputs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources-root', type=Path, required=True)
    parser.add_argument('--layout', type=Path, required=True)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    layout = json.loads(args.layout.read_text())
    for path, data in build(args.sources_root, layout).items():
        write_in_place(path, data, args.check)
        print('PASS' if args.check else 'WROTE', path)


if __name__ == '__main__':
    main()
