// Turns a mongodb+srv:// URI into a standard seed-list URI using DNS-over-HTTPS (for hosts whose resolver cannot do SRV/TXT).
// Prints nothing; returns the URI to the caller. Used by ops scripts on the box only.
export async function resolveUri(uri = process.env.MONGODB_URI) {
  if (!uri?.startsWith('mongodb+srv://')) return uri;
  const u = new URL(uri.replace('mongodb+srv://', 'http://')); const host = u.hostname;
  const q = async (name, type) => (await (await fetch(`https://dns.google/resolve?name=${name}&type=${type}`)).json()).Answer ?? [];
  const hosts = (await q(`_mongodb._tcp.${host}`, 'SRV')).map((a) => { const p = a.data.split(' '); return `${p[3].replace(/\.$/, '')}:${p[2]}`; });
  const txt = (await q(host, 'TXT')).map((a) => a.data.replace(/"/g, '')).join('&');
  const params = new URLSearchParams(txt); for (const [k, v] of u.searchParams) params.set(k, v); if (!params.has('tls')) params.set('tls', 'true');
  const auth = u.username ? `${u.username}:${u.password}@` : '';
  return `mongodb://${auth}${hosts.join(',')}${u.pathname || '/'}?${params}`;
}
