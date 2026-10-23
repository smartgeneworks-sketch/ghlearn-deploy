"""Run: cd /workspace/manuals && python3 /workspace/ghlearn/scripts/manuals/test_apply_state.py"""
import sys, os; sys.path.insert(0, os.path.dirname(__file__))
from apply_verify import apply_state, one_line
a, b = 'a'*24, 'b'*24
log = [f'{a} ERR PATCH /api/documents/{a} -> 502 <!DOCTYPE html>\n', '<html lang="en">\n', '<head>\n', '\n', f'{b} ok pass\n', f'{a} ok flag\n']
assert apply_state(log) == {a: 'ok', b: 'ok'}, apply_state(log)
assert apply_state([f'{a} ok pass\n', f'{a} ERR timeout\n']) == {a: 'ERR'}
assert '\n' not in one_line(Exception('502 <!DOCTYPE html>\n<html>\n<head>')) and len(one_line(Exception('x'*999))) == 200
print('ok')
