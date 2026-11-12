/** Minimal line diff (LCS). Returns ops for display: ' ' same, '-' removed, '+' added. */
export function diffLines(a: string, b: string) {
  const x = (a ?? '').split('\n'), y = (b ?? '').split('\n');
  if (x.length * y.length > 400_000) return [{ op: '-', line: a }, { op: '+', line: b }];
  const L = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: { op: ' ' | '-' | '+'; line: string }[] = []; let i = 0, j = 0;
  while (i < x.length && j < y.length) { if (x[i] === y[j]) { out.push({ op: ' ', line: x[i] }); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: '-', line: x[i++] }); else out.push({ op: '+', line: y[j++] }); }
  while (i < x.length) out.push({ op: '-', line: x[i++] }); while (j < y.length) out.push({ op: '+', line: y[j++] });
  return out;
}
