#!/usr/bin/env python3
"""Create or update the Help Centre articles in docs/help/articles.json on a live API and publish them (audited admin routes).
Usage: python3 scripts/publish-help.py   (uses /workspace/manuals/live.py session helper; super admin)"""
import json, sys, os
sys.path.insert(0, '/workspace/manuals'); from live import S
A = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'docs', 'help', 'articles.json')))
s = S(); have = {p['slug']: p for p in s.call('GET', '/api/admin/website/pages?archived=true')['items']}
for a in A:
    body = {k: a[k] for k in ('slug', 'title', 'audience', 'summary', 'body', 'order')}
    p = have.get(a['slug'])
    if not p: p = s.call('POST', '/api/admin/website/pages', {**body, 'kind': 'help', 'reviewNote': 'Written from the live UI, 2026-10-18'})['page']; act = 'created'
    elif any(p[k] != body[k] for k in body): p = s.call('PATCH', f"/api/admin/website/pages/{p['id']}", body)['page']; act = 'updated'
    else: act = 'unchanged'
    if p['status'] == 'draft': p = s.call('POST', f"/api/admin/website/pages/{p['id']}/publish", {})['page']
    print(a['slug'], act, p['status'])
