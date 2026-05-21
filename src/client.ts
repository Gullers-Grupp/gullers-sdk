/**
 * Gullers Data SDK — generic, schema-agnostic client.
 *
 * Supports two auth modes:
 *   - API key (for internal apps behind a login gate)
 *   - Firebase/Google Identity token (for public apps)
 *
 * Usage:
 *   // Internal app — API key
 *   const api = createClient({ baseUrl: '...', apiKey: 'secret' })
 *
 *   // Public app — Firebase auth
 *   import { getAuth } from 'firebase/auth'
 *   const api = createClient({ baseUrl: '...', tokenProvider: () => getAuth().currentUser?.getIdToken() })
 *
 *   // Query (same API as Supabase):
 *   const { data, error } = await api.from('services').select('*').eq('category', 'analysis')
 */

export interface QueryResult<T = any> {
  data: T | null;
  error: { message: string } | null;
}

/** Returns a Bearer token string, or null/undefined if not authenticated. */
export type AuthProvider = () => Promise<string | null | undefined> | string | null | undefined;

export interface GullersClientOptions {
  baseUrl: string;
  /** Static API key for internal apps. */
  apiKey?: string;
  /** Dynamic token provider for public apps (e.g. Firebase getIdToken). */
  tokenProvider?: AuthProvider;
}

type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'is' | 'in';

interface Filter {
  column: string;
  op: FilterOp;
  value: string;
}

interface OrderClause {
  column: string;
  ascending: boolean;
}

class QueryBuilder<T = any> {
  private _table: string;
  private _client: GullersClient;
  private _select: string | null = null;
  private _filters: Filter[] = [];
  private _order: OrderClause[] = [];
  private _limit: number | null = null;
  private _offset: number | null = null;
  private _method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET';
  private _body: any = null;
  private _single = false;

  constructor(table: string, client: GullersClient) {
    this._table = table;
    this._client = client;
  }

  select(columns: string = '*'): this {
    this._select = columns;
    this._method = 'GET';
    return this;
  }

  insert(data: Partial<T> | Partial<T>[]): this {
    this._method = 'POST';
    this._body = data;
    return this;
  }

  update(data: Partial<T>): this {
    this._method = 'PUT';
    this._body = data;
    return this;
  }

  delete(): this {
    this._method = 'DELETE';
    return this;
  }

  eq(column: string, value: string | number | boolean): this {
    this._filters.push({ column, op: 'eq', value: String(value) });
    return this;
  }

  neq(column: string, value: string | number | boolean): this {
    this._filters.push({ column, op: 'neq', value: String(value) });
    return this;
  }

  gt(column: string, value: string | number): this {
    this._filters.push({ column, op: 'gt', value: String(value) });
    return this;
  }

  gte(column: string, value: string | number): this {
    this._filters.push({ column, op: 'gte', value: String(value) });
    return this;
  }

  lt(column: string, value: string | number): this {
    this._filters.push({ column, op: 'lt', value: String(value) });
    return this;
  }

  lte(column: string, value: string | number): this {
    this._filters.push({ column, op: 'lte', value: String(value) });
    return this;
  }

  like(column: string, pattern: string): this {
    this._filters.push({ column, op: 'like', value: pattern });
    return this;
  }

  ilike(column: string, pattern: string): this {
    this._filters.push({ column, op: 'ilike', value: pattern });
    return this;
  }

  is(column: string, value: 'null' | 'true' | 'false'): this {
    this._filters.push({ column, op: 'is', value });
    return this;
  }

  in(column: string, values: (string | number)[]): this {
    this._filters.push({ column, op: 'in', value: `(${values.join(',')})` });
    return this;
  }

  not(column: string, op: 'is', value: string): this {
    if (op === 'is' && value === 'null') {
      this._filters.push({ column, op: 'neq', value: 'null' });
    }
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this._order.push({ column, ascending: opts?.ascending ?? true });
    return this;
  }

  limit(n: number): this {
    this._limit = n;
    return this;
  }

  offset(n: number): this {
    this._offset = n;
    return this;
  }

  single(): this {
    this._single = true;
    this._limit = 1;
    return this;
  }

  maybeSingle(): this {
    this._single = true;
    this._limit = 1;
    return this;
  }

  async execute(): Promise<QueryResult<T>> {
    try {
      const params = new URLSearchParams();
      if (this._select) params.set('select', this._select);
      for (const f of this._filters) {
        params.set(f.column, `${f.op}.${f.value}`);
      }
      if (this._order.length) {
        params.set(
          'order',
          this._order.map((o) => `${o.column}.${o.ascending ? 'asc' : 'desc'}`).join(','),
        );
      }
      if (this._limit !== null) params.set('limit', String(this._limit));
      if (this._offset !== null) params.set('offset', String(this._offset));

      const qs = params.toString();
      const url = `${this._client.baseUrl}/api/data/${this._table}${qs ? '?' + qs : ''}`;

      const headers = await this._client.getHeaders();
      if (this._body) headers['Content-Type'] = 'application/json';

      const res = await fetch(url, {
        method: this._method,
        headers,
        body: this._body ? JSON.stringify(this._body) : undefined,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        return { data: null, error: { message: err.error ?? res.statusText } };
      }

      const data = await res.json();
      return { data: this._single ? (data[0] ?? null) : data, error: null };
    } catch (e: any) {
      return { data: null, error: { message: e.message } };
    }
  }

  then<R>(
    resolve: (value: QueryResult<T>) => R,
    reject?: (reason: any) => R,
  ): Promise<R> {
    return this.execute().then(resolve, reject);
  }
}

export class GullersClient {
  readonly baseUrl: string;
  private _apiKey?: string;
  private _tokenProvider?: AuthProvider;

  constructor(opts: GullersClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this._apiKey = opts.apiKey;
    this._tokenProvider = opts.tokenProvider;
  }

  /** Build auth headers. API key takes precedence; falls back to token provider. */
  async getHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};
    if (this._apiKey) {
      headers['Authorization'] = `Bearer ${this._apiKey}`;
    } else if (this._tokenProvider) {
      const token = await this._tokenProvider();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  from<T = any>(table: string): QueryBuilder<T> {
    return new QueryBuilder<T>(table, this);
  }

  async rpc<T = any>(fn: string, args?: Record<string, any>): Promise<QueryResult<T>> {
    try {
      const headers = await this.getHeaders();
      headers['Content-Type'] = 'application/json';
      const res = await fetch(`${this.baseUrl}/api/rpc/${fn}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(args ?? {}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        return { data: null, error: { message: err.error ?? res.statusText } };
      }
      return { data: await res.json(), error: null };
    } catch (e: any) {
      return { data: null, error: { message: e.message } };
    }
  }

  get functions() {
    return {
      invoke: async <T = any>(fn: string, opts?: { body?: any }): Promise<QueryResult<T>> => {
        return this.rpc<T>(fn, opts?.body);
      },
    };
  }
}

export function createClient(opts: GullersClientOptions): GullersClient {
  return new GullersClient(opts);
}
