import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * A small, safe Markdown subset for admin-written pages (help articles, legal drafts): ## / ### headings,
 * paragraphs, | tables |, "- " and "1. " lists, "> " notes, **bold** and [links](/path or https://...). No raw HTML is ever
 * rendered; everything becomes React elements.
 */
const safeHref = (h: string) => (/^\/(?!\/)[\w\-./?=&#%]*$/.test(h) || /^https:\/\/[^\s"'<>]+$/.test(h) || /^mailto:[^\s"'<>]+$/.test(h) || /^tel:\+?[\d\s-]+$/.test(h) ? h : null);
export function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = []; const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g; let last = 0; let m: RegExpExecArray | null; let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={`${key}b${n++}`}>{m[1]}</strong>);
    else { const h = safeHref(m[3]); out.push(!h ? m[2] : h.startsWith('/') ? <Link key={`${key}l${n++}`} to={h} className="font-semibold text-brand-800 underline">{m[2]}</Link>
      : <a key={`${key}l${n++}`} href={h} className="font-semibold text-brand-800 underline" {...(h.startsWith('https:') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{m[2]}</a>); }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
export function Markdown({ source, className = '' }: { source: string; className?: string }) {
  const blocks = source.replace(/\r\n/g, '\n').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return <div className={`space-y-3 leading-relaxed text-slate-700 ${className}`}>{blocks.map((b, i) => {
    const lines = b.split('\n');
    if (/^### /.test(b)) return <h3 key={i} className="pt-2 text-lg font-bold text-navy-900">{inline(b.slice(4), `h${i}`)}</h3>;
    if (/^## /.test(b)) return <h2 key={i} className="pt-3 text-xl font-bold text-navy-900">{inline(b.slice(3), `h${i}`)}</h2>;
    if (lines.length >= 2 && lines.every((l) => /^\|.*\|$/.test(l)) && /^\|[\s:|-]+\|$/.test(lines[1])) {
      const cells = (l: string) => l.slice(1, -1).split('|').map((c) => c.trim()); const [head, , ...rows] = lines;
      return <div key={i} className="overflow-x-auto"><table className="w-full border-collapse text-left text-sm"><thead><tr>{cells(head).map((c, j) => <th key={j} scope="col" className="border-b-2 border-slate-300 px-3 py-2 font-semibold text-navy-900">{inline(c, `t${i}h${j}`)}</th>)}</tr></thead>
        <tbody>{rows.map((r, k) => <tr key={k}>{cells(r).map((c, j) => <td key={j} className="border-b border-slate-200 px-3 py-2 align-top">{inline(c, `t${i}${k}${j}`)}</td>)}</tr>)}</tbody></table></div>;
    }
    if (lines.every((l) => /^- /.test(l))) return <ul key={i} className="list-disc space-y-1 pl-6">{lines.map((l, j) => <li key={j}>{inline(l.slice(2), `u${i}${j}`)}</li>)}</ul>;
    if (lines.every((l) => /^\d+\. /.test(l))) return <ol key={i} className="list-decimal space-y-1 pl-6">{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\d+\. /, ''), `o${i}${j}`)}</li>)}</ol>;
    if (lines.every((l) => /^> ?/.test(l))) return <p key={i} className="rounded-lg border-l-4 border-brand-600 bg-brand-50 px-4 py-3 text-slate-800">{inline(lines.map((l) => l.replace(/^> ?/, '')).join(' '), `q${i}`)}</p>;
    return <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l, `p${i}${j}`)}</Fragment>)}</p>;
  })}</div>;
}
