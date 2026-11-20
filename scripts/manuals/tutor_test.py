from live import S; import json
s=S('kofi@sample.ghlearn.test')
tests=[('6ad0200733e70788b3fb54ea','Mathematics','How do I calculate the probability of two independent events happening together?'),
       ('6ad0200733e70788b3fb54e9','English Language','What is the difference between a phrase and a clause? Give an example.'),
       ('6ad0200733e70788b3fb54ec','Social Studies','What are the main features of the 1992 Constitution of Ghana?')]
out=[]
for sid,name,q in tests:
    c=s.call('POST','/api/tutor/conversations',{'subjectId':sid})['conversation']['_id']
    raw=s.call('POST',f'/api/tutor/conversations/{c}/messages',{'content':q,'mode':'explain'},raw=True,timeout=180).decode()
    ev=None; done=None; meta=None
    for l in raw.splitlines():
        if l.startswith('event:'): ev=l[6:].strip()
        elif l.startswith('data:') and ev in ('done','meta','error'):
            d=json.loads(l[5:])
            if ev=='done': done=d
            elif ev=='meta': meta=d
            else: done={'error':d}
    cites=[(x.get('documentTitle'),x.get('pageStart'),x.get('pageEnd')) for x in (done or {}).get('citations',[])]
    out.append({'subject':name,'q':q,'answerType':(done or {}).get('answerType'),'sources':meta,'citations':cites,'text':(done or {}).get('text','')[:300],'error':(done or {}).get('error')})
    s.call('DELETE',f'/api/tutor/conversations/{c}',raw=True)
json.dump(out,open('tutor_results.json','w'),indent=1)
for o in out: print(json.dumps(o)[:900]); print()
