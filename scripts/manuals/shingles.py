import json, subprocess, re, hashlib, pickle
from concurrent.futures import ProcessPoolExecutor
A=[json.loads(l) for l in open('analysis.jsonl')]
def sh(i):
    t=subprocess.run(['pdftotext','-enc','UTF-8',f'pdf/{i}.pdf','-'],capture_output=True,timeout=600).stdout.decode('utf-8','replace')
    w=re.findall(r'[a-z0-9]+',t.lower()); s=set()
    for k in range(len(w)-7):
        h=int.from_bytes(hashlib.blake2b(' '.join(w[k:k+8]).encode(),digest_size=8).digest(),'little')
        if h%8==0: s.add(h)
    return i,s
ids=[a['id'] for a in A if 'pages' in a]
with ProcessPoolExecutor(8) as ex: S=dict(ex.map(sh,ids,chunksize=8))
pickle.dump(S,open('shingles.pkl','wb')); print(len(S), sum(len(v) for v in S.values()))
