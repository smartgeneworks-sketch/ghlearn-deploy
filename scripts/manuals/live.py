import json, urllib.request, http.cookiejar, os, time
A='https://api.ghlearn.com'; O='https://ghlearn.com'
def _pw():
    for l in open('/home/box/.ghlearn-deploy/secrets.env'):
        if l.startswith('SEED_PASSWORD='): return l.split('=',1)[1].strip().strip('"\'')
class S:
    def __init__(s, email='super@sample.ghlearn.test'):
        s.cj=http.cookiejar.CookieJar(); s.op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(s.cj)); s.email=email; s.login()
    def login(s):
        s.csrf=s._req('GET','/api/auth/csrf')['csrfToken']; s._req('POST','/api/auth/login',{'email':s.email,'password':_pw()})
    def _req(s,m,p,b=None,raw=False,timeout=120):
        h={'Origin':O,'Content-Type':'application/json'}
        if getattr(s,'csrf',None): h['X-CSRF-Token']=s.csrf
        r=urllib.request.Request(A+p,data=json.dumps(b).encode() if b is not None else None,method=m,headers=h)
        try:
            with s.op.open(r,timeout=timeout) as resp: d=resp.read(); return d if raw else (json.loads(d) if d else {})
        except urllib.error.HTTPError as e:
            body=e.read().decode()[:500]; raise RuntimeError(f'{m} {p} -> {e.code} {body}')
    def call(s,m,p,b=None,**k):
        for i in range(3):
            try: return s._req(m,p,b,**k)
            except RuntimeError as e:
                if '-> 401' in str(e): s.login(); continue
                if any(c in str(e) for c in ('-> 502','-> 503','-> 504')): time.sleep(5); continue
                raise
        return s._req(m,p,b,**k)
