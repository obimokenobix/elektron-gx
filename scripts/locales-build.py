# TSV (Nummer<TAB>Übersetzung) → locales/<code>.json, mit Prüfung von Vollständigkeit und Platzhaltern
import json, re, sys, os
import pathlib
ROOT=str(pathlib.Path(__file__).resolve().parent.parent / 'locales')
keys=json.load(open(ROOT+'/_keys.json'))
ok=True
for path in sys.argv[1:]:
    code=os.path.basename(path)[:-4]
    vals=[None]*len(keys); errs=[]
    for ln, line in enumerate(open(path, encoding='utf-8').read().splitlines(), 1):
        if not line.strip(): continue
        if '\t' not in line: errs.append(f'Zeile {ln}: kein Tab'); continue
        n, t = line.split('\t', 1)
        try: i=int(n)
        except: errs.append(f'Zeile {ln}: Nummer?'); continue
        if not 0 <= i < len(keys): errs.append(f'Nummer {i} zu groß'); continue
        if vals[i] is not None: errs.append(f'Nummer {i} doppelt')
        vals[i]=t.strip()
    miss=[i for i,v in enumerate(vals) if not v]
    if miss: errs.append(f'fehlt: {miss[:20]}{"…" if len(miss)>20 else ""} ({len(miss)})')
    for i,(k,v) in enumerate(zip(keys,vals)):
        if v is None: continue
        if sorted(re.findall(r'\{\d+\}',k)) != sorted(re.findall(r'\{\d+\}',v)): errs.append(f'{i}: Platzhalter {re.findall(r"{\d+}",k)} ≠ {re.findall(r"{\d+}",v)}')
    if errs:
        ok=False; print(code, 'FEHLER:', *errs[:15], sep='\n  ')
    else:
        json.dump(vals, open(f'{ROOT}/{code}.json','w',encoding='utf-8'), ensure_ascii=False, separators=(',',':'))
        print(code, 'ok', len(vals))
sys.exit(0 if ok else 1)
