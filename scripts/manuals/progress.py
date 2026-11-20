import json, collections as C, datetime
from live import S
R=json.load(open('verify.json')); SEL=json.load(open('selection.json')); D=json.load(open('all_docs.json'))
A={a['id']:a for a in map(json.loads,open('analysis.jsonl'))}
L=[d for d in D if d.get('docType')=='learner_manual']
from apply_verify import apply_state
applied=apply_state(open('apply.log'))
s=S(); run=s.call('GET','/api/documents/bulk-process').get('run'); st=s.call('GET','/api/analytics')['storage']
cats=C.Counter(c for r in R.values() if not r['pass'] for c in {f[0] for f in r['fails']})
sel=SEL['selected']
out={'updatedAt':datetime.datetime.utcnow().isoformat()+'Z',
 'inventory':{'learnerManualRecords':len(L),'byteIdenticalDuplicates':sum(1 for d in L if d.get('duplicateOf')),'canonical':len(R),
   'canonicalBySection':C.Counter(r['section'] for r in R.values()),'pages':sum(a.get('pages',0) for a in A.values()),'textChars':sum(a.get('chars',0) for a in A.values()),'pdfMB':round(sum(d['sizeBytes'] for d in L if not d.get('duplicateOf'))/1e6)},
 'verification':{'passed':sum(r['pass'] for r in R.values()),'flagged':sum(not r['pass'] for r in R.values()),'flagCategories':cats,
   'appliedLive':sum(v=='ok' for v in applied.values()),'applyErrors':sum(v=='ERR' for v in applied.values()),'applyTransientRetried':sum(1 for l in open('apply.log') if ' ERR ' in l)},
 'ingestPlan':{'selected':len(sel),'contentCovered':len(SEL['covered']),'pages':sum(A[i]['pages'] for i in sel),'textChars':sum(A[i]['chars'] for i in sel)},
 'bulkRun':run,'storage':{'dataMB':round(st['dataBytes']/2**20,1),'indexMB':round(st['indexBytes']/2**20,1),'quotaMB':512,'collections':st.get('collectionSizes')}}
json.dump(out,open('/workspace/ghlearn/docs/MANUALS_PROGRESS.json','w'),indent=1,default=str); print(json.dumps(out['verification']), json.dumps(out['bulkRun']['now'] if run else None), out['storage']['dataMB'], out['storage']['indexMB'])
