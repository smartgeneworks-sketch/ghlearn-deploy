import json, re, collections as C
D={d['_id']:d for d in json.load(open('all_docs.json'))}
A={a['id']:a for a in map(json.loads,open('analysis.jsonl'))}
idx={x['url']:x for x in json.load(open('/workspace/curriculum/index.json'))}
SHS='6ad0200533e70788b3fb54e3'
def norm(s): return re.sub(r'[^a-z0-9 ]',' ',(s or '').lower().replace('&',' and '))
STOP={'and','of','the','in','studies','language','core','elective','science','for','ghanaian','home','economics','religious','business'}
ALIAS={'ict':['ict','information and communication technology'],'additional mathematics':['additional mathematics','additional maths','add maths','elective mathematics'],
 'business studies accounting':['accounting','business studies'],'business studies business management':['business management','business studies'],
 'religious studies christian':['christian','religious studies'],'religious studies islamic':['islamic','religious studies'],
 'physical education and health core':['physical education','pe and health','physical education and health'],'physical education and health elective':['physical education','physical education and health'],
 'home economics clothing and textiles':['clothing and textiles','clothing','textiles'],'home economics food and nutrition':['food and nutrition'],'home economics management in living':['management in living'],
 'art and design foundation':['art and design foundation','art and design'],'arts and design studio':['art and design studio','arts and design studio','design studio'],
 'intervention english':['intervention english','english'],'intervention mathematics':['intervention mathematics','intervention maths','mathematics','maths'],
 'mathematics':['mathematics','maths'],'general science':['general science','integrated science','science'],'literature in english':['literature in english','literature'],
 'information and communication technology ict':['ict','information and communication technology'],'aviation and aerospace engineering':['aviation','aerospace'],
 'design and communication technology':['design and communication technology','dct'],'religious and moral education':['religious and moral education','rme'],
 'ghanaian language':['ghanaian language','dagbanli','twi','ewe','ga ','dagbani','dagaare','dangme','gonja','gurene','kasem','mfantse','nzema','fante','akuapem','asante','language'],
 'manufacturing engineering':['manufacturing'],'electrical and electronic technology':['electrical','electronic'],'automotive and metal technology':['automotive','metal'],
 'building construction and wood technology':['building construction','wood'],'agricultural science':['agricultural science','agric'],'agriculture':['agriculture','agricultural'],
 'computing':['computing'],'performing arts':['performing arts','music','dance','drama','theatre'],'robotics':['robotics'],'biomedical science':['biomedical'],'engineering':['engineering'],
}
def subj_terms(name):
    n=' '.join(norm(name).split())
    if n.startswith('ghanaian language '): t=n.split(' ',2)[2]; return [t]+(['dagbanli'] if t=='dagbani' else [])  # e.g. ewe
    return ALIAS.get(n,[n])
def ver(d):
    t=(d['title']+' '+(d.get('originalFilename') or '')+' '+(d.get('documentVersion') or '')).lower()
    if re.search(r'teacher|\btv\b|tversion|t version|_tv|\(tv\)',t): return 'TV'
    if re.search(r'learner|\blv\b|lversion|l version|_lv|\(lv\)',t): return 'LV'
    return '?'
def years_in(s):
    s=s.lower(); ys=set(int(y) for y in re.findall(r'(?:year|yr|\by|book)\s*[-_ ]?\s*([1-3])\b',s))
    ys|=set({'one':1,'two':2,'three':3}[w] for w in re.findall(r'year (one|two|three)',s)); return ys
res={}
for i,d in D.items():
    if d.get('docType')!='learner_manual' or d.get('duplicateOf'): continue
    a=A.get(i,{}); x=idx[d['provenance']['sourceUrl']]; fails=[]; flags=[]
    hay=norm(d['title']+' '+(d.get('originalFilename') or '')+' '+a.get('cover',''))
    # 1 opens
    if a.get('open_error') or a.get('text_error') or 'pages' not in a: fails.append(('file_unreadable','PDF does not open cleanly: '+(a.get('open_error') or a.get('text_error') or '')[:80]))
    elif a.get('encrypted'): fails.append(('file_unreadable','PDF is encrypted'))
    else:
        # 2 text
        p=a['pages']; low=a['low_pages']
        if p and low/p>0.5: fails.append(('needs_ocr',f'{low} of {p} pages have no text layer (OCR not configured)'))
        elif p and low/p>0.2: fails.append(('partial_text',f'{low} of {p} pages have no text layer'))
        # 5 page count
        if not (4<=p<=600): fails.append(('page_count',f'{p} pages is outside the plausible range 4-600'))
    # 3 metadata
    sj=(d.get('subjectId') or {}).get('name')
    if not sj: fails.append(('metadata','No subject mapped in the catalog'))
    elif not any(t.strip() and t in hay for t in subj_terms(sj)): fails.append(('metadata',f'Subject "{sj}" not found in the title or cover'))
    if d.get('levelId')!=SHS:
        fails.append(('jhs_disabled' if 'JHS' in x['section'] else 'metadata', 'JHS manual (JHS is disabled; level not set)' if 'JHS' in x['section'] else 'Level not set in the catalog'))
    elif re.search(r'for junior high school|\bjhs ?[123]\b|\bb[789] ?[1-9] ?[1-9]',hay): fails.append(('metadata','Catalog level SHS but the file says JHS/Basic'))
    yrs=years_in(d['title']+' '+(d.get('originalFilename') or '')+' '+a.get('cover','')[:600])
    if d.get('levelId')==SHS:
        if not d.get('yearOfStudy'): fails.append(('metadata','Year of study not set in the catalog'))
        elif yrs and d['yearOfStudy'] not in yrs: fails.append(('metadata',f'Catalog year {d["yearOfStudy"]} but the file says year {sorted(yrs)}'))
        elif not yrs and d['yearOfStudy']!=1: fails.append(('metadata',f'Catalog year {d["yearOfStudy"]} not confirmed by the title or cover'))
        elif not yrs: flags.append('year 1 inferred (section files carry no year on the cover)')
    # 4 learner manual
    v=ver(d)
    if v=='TV': fails.append(('teacher_version','Teacher Version (TV) of the learner material, not the learner version'))
    if re.search(r"teacher[’']?s? (manual|guide)|syllabus|curriculum framework|scheme of learning",hay[:400]): fails.append(('not_learner_manual','Cover reads as a teacher manual / syllabus'))
    # 6 source
    if not d['provenance']['sourceUrl'].startswith('https://curriculumresources.edu.gh/'): fails.append(('source','Not from curriculumresources.edu.gh'))
    res[i]={'pass':not fails,'fails':fails,'notes':flags,'version':v,'pages':a.get('pages'),'chars':a.get('chars'),'subject':sj,'year':d.get('yearOfStudy'),'title':d['title'],'section':x['section']}
json.dump(res,open('verify.json','w'),indent=0)
print('checked',len(res),'pass',sum(r['pass'] for r in res.values()))
cat=C.Counter(); 
for r in res.values():
    for c in {f[0] for f in r['fails']}: cat[c]+=1
print(cat)
prim=C.Counter(r['fails'][0][0] for r in res.values() if r['fails']); print('primary',prim)
