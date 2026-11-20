import pickle, json, collections as C
S=pickle.load(open('shingles.pkl','rb')); R=json.load(open('verify.json'))
D={d['_id']:d for d in json.load(open('all_docs.json'))}
P=[i for i,r in R.items() if r['pass']]
def pref(i): return ({'LV':0,'?':1,'TV':2}[R[i]['version']], 0 if R[i]['section']=='SHS' else 1, D[i]['sizeBytes'])
# seed coverage with already indexed docs
cov=set(); sel=[]; cover={}
owner={}
for i in sorted(P,key=pref):
    s=S.get(i,set())
    if not s: continue
    inter=s&cov; new=1-len(inter)/len(s)
    if new>=0.3:
        sel.append(i); 
        for h in s-cov: owner[h]=i
        cov|=s
    else:
        c=C.Counter(owner[h] for h in inter).most_common(1)[0][0]; cover[i]=(c, round(1-new,2))
json.dump({'selected':sel,'covered':cover},open('selection.json','w'))
A={a['id']:a for a in map(json.loads,open('analysis.jsonl'))}
print('pass',len(P),'selected',len(sel),'covered',len(cover))
print('pages',sum(A[i]['pages'] for i in sel),'chars',sum(A[i]['chars'] for i in sel),'nows',sum(A[i]['nows'] for i in sel))
big=[i for i in sel if D[i]['sizeBytes']>40e6]; print('selected >40MB',len(big), [round(D[i]['sizeBytes']/1e6) for i in big])
print('size pct', sorted(round(D[i]['sizeBytes']/1e6,1) for i in sel)[::len(sel)//10])
print('pages pct', sorted(A[i]['pages'] for i in sel)[::len(sel)//10])
