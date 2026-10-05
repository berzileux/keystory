export interface Entry {
  id: string;
  text: string;
  difficulty: 'easy' | 'medium' | 'hard';
  source: { title: string; author: string; year: number };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

export async function loadCorpus(base = `${import.meta.env.BASE_URL}corpus`): Promise<Entry[]> {
  const index = await getJson<{ sources: { file: string }[] }>(`${base}/index.json`);
  const files = await Promise.all(
    index.sources.map((s) =>
      getJson<{ source: Entry['source']; passages: { id: string; text: string; difficulty: Entry['difficulty'] }[] }>(
        `${base}/${s.file}`,
      ),
    ),
  );
  const entries = files.flatMap((f) => f.passages.map((p) => ({ ...p, source: f.source })));
  if (entries.length === 0) throw new Error('The corpus has no passages');
  return entries;
}
