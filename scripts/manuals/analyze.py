import json, os, subprocess, re, hashlib, sys
from concurrent.futures import ThreadPoolExecutor
D={d['_id']:d for d in json.load(open('all_docs.json'))}
out_path='analysis.jsonl'; done=set()
if os.path.exists(out_path):
    for l in open(out_path): done.add(json.loads(l)['id'])
ids=[l.split()[0] for l in open('dl.log') if ' ok' in l or 'cached' in l]
def run(i):
    f=f'pdf/{i}.pdf'; r={'id':i}
    info=subprocess.run(['pdfinfo',f],capture_output=True,text=True,timeout=120)
    if info.returncode!=0: r['open_error']=info.stderr[:200]; return r
    m=re.search(r'^Pages:\s+(\d+)',info.stdout,re.M); r['pages']=int(m.group(1)) if m else 0
    r['encrypted']=bool(re.search(r'^Encrypted:\s+yes',info.stdout,re.M))
    t=subprocess.run(['pdftotext','-enc','UTF-8',f,'-'],capture_output=True,timeout=600)
    if t.returncode!=0: r['text_error']=t.stderr.decode()[:200]; return r
    txt=t.stdout.decode('utf-8','replace'); pages=txt.split('\f')[:r['pages']]
    cc=[len(re.sub(r'\s+','',p)) for p in pages]
    r['chars']=sum(len(p) for p in pages); r['nows']=sum(cc); r['low_pages']=sum(1 for c in cc if c<25)
    r['cover']=re.sub(r'\s+',' ',' '.join(pages[:3]))[:1500]
    norm=re.sub(r'[^a-z0-9]','',txt.lower())
    r['texthash']=hashlib.sha256(norm.encode()).hexdigest()[:16]
    # shingle signature for near-dup: 64 min-hashes over 8-word shingles
    w=re.findall(r'[a-z0-9]+',txt.lower()); sh={' '.join(w[k:k+8]) for k in range(0,max(1,len(w)-7),3)}
    hs=[int(hashlib.md5(s.encode()).hexdigest()[:12],16) for s in sh] or [0]
    r['minhash']=[min((h*(2*j+1)+j*7919)%(1<<48) for h in hs) for j in range(48)]
    r['teacher_markers']=len(re.findall(r'(?i)teacher[’\']?s? (note|guide|version|activity|instruction)|facilitat|pedagogical exemplar|key assessment|note to (the )?teacher',txt))
    r['learner_markers']=len(re.findall(r'(?i)learner[’\']?s? (version|material)|you will learn|activity \d',txt))
    return r
todo=[i for i in ids if i not in done]
with ThreadPoolExecutor(6) as ex, open(out_path,'a') as o:
    for r in ex.map(run,todo): o.write(json.dumps(r)+'\n'); o.flush()
print('analyzed',len(todo))
