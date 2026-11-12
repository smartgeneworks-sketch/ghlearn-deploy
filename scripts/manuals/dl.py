import json, hashlib, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
D=json.load(open('all_docs.json'))
can=[d for d in D if d.get('docType')=='learner_manual' and not d.get('duplicateOf')]
drv={}
for l in open('/workspace/curriculum/uploaded.jsonl'):
    x=json.loads(l); drv.setdefault(x['url'],x['driveFileId'])
os.makedirs('pdf',exist_ok=True)
def sha(p):
    h=hashlib.sha256(); f=open(p,'rb')
    for b in iter(lambda:f.read(1<<20),b''): h.update(b)
    return h.hexdigest()
def one(d):
    i=d['_id']; f=f'pdf/{i}.pdf'; want=d['provenance']['checksum']; url=d['provenance']['sourceUrl']
    if os.path.exists(f) and sha(f)==want: return i,'cached'
    srcs=[]
    if drv.get(url): srcs.append(f"https://drive.usercontent.google.com/download?id={drv[url]}&export=download&confirm=t")
    srcs.append(url)
    for k,s in enumerate(srcs):
        r=subprocess.run(['curl','-sL','--max-time','400','-o',f+'.tmp',s])
        if r.returncode==0 and os.path.exists(f+'.tmp') and sha(f+'.tmp')==want: os.replace(f+'.tmp',f); return i,'ok-'+('drive' if 'drive' in s else 'source')
    if os.path.exists(f+'.tmp'): os.remove(f+'.tmp')
    return i,'FAIL'
with ThreadPoolExecutor(8) as ex, open('dl.log','w') as log:
    for i,st in ex.map(one,can): log.write(f'{i} {st}\n'); log.flush()
print('done')
