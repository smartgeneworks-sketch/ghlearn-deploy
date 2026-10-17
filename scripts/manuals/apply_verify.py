import json, sys, time, pickle, re, collections as C
from live import S
R=json.load(open('verify.json')); SEL=json.load(open('selection.json'))
D={d['_id']:d for d in json.load(open('all_docs.json'))}
best=json.load(open('containment.json'))
sel=set(SEL['selected']); cov=SEL['covered']
DAY='2026-10-16'
LABEL={'teacher_version':'teacher version','metadata':'metadata mismatch','needs_ocr':'needs OCR','partial_text':'partial text layer','file_unreadable':'file unreadable','page_count':'implausible page count','not_learner_manual':'not a learner manual','source':'unofficial source','jhs_disabled':'JHS (disabled)'}
def plan(i):
    r=R[i]; base=f"automated check {DAY}: SHA-256 matches the import; PDF opens ({r['pages']} pages); "
    if r['pass']:
        inferred=any('inferred' in n for n in r['notes'])
        yr=f"catalog year {r['year']} not contradicted (section files carry no year on the cover)" if inferred else f"year {r['year']} matches"
        note=base+f"text layer on at least 80% of pages; subject \"{r['subject']}\" and SHS match the title/cover; {yr}; learner version; source curriculumresources.edu.gh."
        flags=[]
        if i in cov:
            c,f=cov[i]; note+=f" Not indexed separately: {round(f*100)}% of its text is already in \"{D[c]['title']}\" ({c})."; flags=['content_covered']
        return {'approvalStatus':'verified_official','approvalNote':note[:1000],'reviewFlags':flags}, (D[i].get('mappingStatus')!='confirmed')
    reasons='; '.join(m for _,m in r['fails'])
    note=f"automated check {DAY}: NOT verified - {reasons}."
    if any(c=='teacher_version' for c,_ in r['fails']):
        j,f=best.get(i,[None,0])
        if j and f>=0.7 and R.get(j,{}).get('pass') and R[j]['version']!='TV': note+=f" The learner version \"{D[j]['title']}\" ({j}) covers {round(f*100)}% of this text and is verified."
        else: note+=" No verified learner version on file covers this text."
    return {'approvalNote':note[:1000],'reviewFlags':sorted({c for c,_ in r['fails']})}, False
def one_line(e, n=200):
    """Error text for apply.log: one line per attempt (a 502 page is multi-line HTML), so the log stays parseable."""
    return ' '.join(str(e).split())[:n]
def apply_state(lines):
    """Latest outcome per document from apply.log lines (an id that failed and was later retried ok counts as ok)."""
    st={}
    for l in lines:
        t=l.split()
        if len(t)>=2 and re.fullmatch(r'[0-9a-f]{24}', t[0]) and t[1] in ('ok','ERR'): st[t[0]]=t[1]
    return st
if __name__=='__main__':
    s=S(); done=set()
    try: done={i for i,v in apply_state(open('apply.log')).items() if v=='ok'}
    except FileNotFoundError: pass
    with open('apply.log','a') as log:
        for i in R:
            if i in done: continue
            body,confirm=plan(i)
            try:
                s.call('PATCH',f'/api/documents/{i}',body)
                if confirm: s.call('PATCH',f'/api/documents/{i}',{'mappingStatus':'confirmed'})
                log.write(f"{i} ok {'pass' if R[i]['pass'] else 'flag'}\n")
            except Exception as e: log.write(f"{i} ERR {one_line(e)}\n")
            log.flush()
    print('done')
