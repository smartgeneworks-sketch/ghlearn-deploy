/** Tiny, safe markdown renderer (escapes everything; supports headings, lists, bold/italic, code, citations). */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
function inline(s: string) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>').replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\$\\rightarrow\$/g, '→').replace(/\[S(\d+)\]/g, '<sup class="text-brand-700">[S$1]</sup>');
}
export function toHtml(md: string) {
  const out: string[] = []; let list: 'ul' | 'ol' | null = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of (md ?? '').split('\n')) {
    const line = raw.trimEnd(); let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) { close(); const n = Math.min(4, m[1].length + 1); out.push(`<h${n} class="font-semibold mt-3">${inline(m[2])}</h${n}>`); }
    else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { close(); out.push('<ul class="list-disc pl-6 space-y-1">'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); out.push('<ol class="list-decimal pl-6 space-y-1">'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if (/^-{3,}$/.test(line.trim())) { close(); out.push('<hr class="my-3"/>'); }
    else if (!line.trim()) close();
    else { close(); out.push(`<p class="my-2">${inline(line)}</p>`); }
  }
  close(); return out.join('');
}
export function Markdown({ text }: { text: string }) { return <div className="leading-relaxed" dangerouslySetInnerHTML={{ __html: toHtml(text) }} />; }
