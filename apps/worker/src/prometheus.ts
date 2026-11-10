/** Minimal Prometheus HTTP API client: readiness and instant queries. */
export class Prometheus {
  constructor(private readonly baseUrl: string) {}

  async ready(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/-/ready`, { signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async query(query: string, at?: Date) {
    const body = new URLSearchParams({ query });
    if (at) body.set("time", String(at.getTime() / 1000));
    const res = await fetch(`${this.baseUrl}/api/v1/query`, { method: "POST", body, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Prometheus ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { data: { result: { metric: Record<string, string>; value: [number, string] }[] } };
    return json.data.result;
  }

  /** First sample of an instant query; null when the result is empty or not a number (no data yet). */
  async scalar(query: string, at?: Date): Promise<number | null> {
    const first = (await this.query(query, at))[0];
    if (!first) return null;
    const n = Number(first.value[1]);
    return Number.isFinite(n) ? n : null;
  }

  /** An instant vector as label value -> number; non-numbers (NaN) are left out. */
  async byLabel(query: string, label: string, at?: Date): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const r of await this.query(query, at)) {
      const n = Number(r.value[1]);
      if (Number.isFinite(n)) out[r.metric[label] ?? ""] = n;
    }
    return out;
  }

  /** Several scalars at once, keyed like the input. */
  async scalars<K extends string>(queries: Record<K, string>, at?: Date): Promise<Record<K, number | null>> {
    const keys = Object.keys(queries) as K[];
    const values = await Promise.all(keys.map((k) => this.scalar(queries[k], at)));
    return Object.fromEntries(keys.map((k, i) => [k, values[i]])) as Record<K, number | null>;
  }
}
