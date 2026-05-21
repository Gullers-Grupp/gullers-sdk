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
  /** App identifier — used for per-user access control on external apps. */
  appId?: string;
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

// ── Auth types ──────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email?: string;
  [key: string]: any;
}

export interface AuthSession {
  access_token: string;
  user: AuthUser;
  [key: string]: any;
}

type AuthChangeEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED';
type AuthChangeCallback = (event: AuthChangeEvent, session: AuthSession | null) => void;

class AuthClient {
  private _client: GullersClient;
  private _session: AuthSession | null = null;
  private _listeners: Set<AuthChangeCallback> = new Set();

  constructor(client: GullersClient) {
    this._client = client;
  }

  private _notify(event: AuthChangeEvent, session: AuthSession | null) {
    this._session = session;
    this._listeners.forEach((cb) => cb(event, session));
  }

  async signInWithPassword(creds: { email: string; password: string }): Promise<{ data: { session: AuthSession | null; user: AuthUser | null }; error: any }> {
    try {
      const headers = await this._client.getHeaders();
      headers['Content-Type'] = 'application/json';
      const res = await fetch(`${this._client.baseUrl}/api/auth/sign-in`, {
        method: 'POST',
        headers,
        body: JSON.stringify(creds),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        return { data: { session: null, user: null }, error: { message: err.error ?? res.statusText } };
      }
      const data = await res.json();
      this._notify('SIGNED_IN', data.session);
      return { data: { session: data.session, user: data.session?.user ?? null }, error: null };
    } catch (e: any) {
      return { data: { session: null, user: null }, error: { message: e.message } };
    }
  }

  async signOut(opts?: { scope?: string }): Promise<{ error: any }> {
    try {
      const headers = await this._client.getHeaders();
      await fetch(`${this._client.baseUrl}/api/auth/sign-out`, {
        method: 'POST',
        headers,
      }).catch(() => {});
      this._notify('SIGNED_OUT', null);
      return { error: null };
    } catch (e: any) {
      this._notify('SIGNED_OUT', null);
      return { error: { message: e.message } };
    }
  }

  async getSession(): Promise<{ data: { session: AuthSession | null }; error: any }> {
    try {
      const headers = await this._client.getHeaders();
      const res = await fetch(`${this._client.baseUrl}/api/auth/session`, {
        headers,
      });
      if (!res.ok) {
        return { data: { session: null }, error: null };
      }
      const data = await res.json();
      this._session = data.session ?? null;
      return { data: { session: this._session }, error: null };
    } catch (e: any) {
      return { data: { session: null }, error: { message: e.message } };
    }
  }

  async getUser(): Promise<{ data: { user: AuthUser | null }; error: any }> {
    try {
      const headers = await this._client.getHeaders();
      const res = await fetch(`${this._client.baseUrl}/api/auth/user`, {
        headers,
      });
      if (!res.ok) {
        return { data: { user: null }, error: null };
      }
      const data = await res.json();
      return { data: { user: data.user ?? null }, error: null };
    } catch (e: any) {
      return { data: { user: null }, error: { message: e.message } };
    }
  }

  onAuthStateChange(callback: AuthChangeCallback): { data: { subscription: { unsubscribe: () => void } } } {
    this._listeners.add(callback);
    // Fire immediately with current state
    if (this._session) callback('SIGNED_IN', this._session);
    return {
      data: {
        subscription: {
          unsubscribe: () => { this._listeners.delete(callback); },
        },
      },
    };
  }
}

// ── Storage types ───────────────────────────────────────────────────────

class StorageBucketClient {
  private _bucket: string;
  private _client: GullersClient;

  constructor(bucket: string, client: GullersClient) {
    this._bucket = bucket;
    this._client = client;
  }

  async upload(path: string, file: File | Blob | ArrayBuffer): Promise<{ data: { path: string } | null; error: any }> {
    try {
      const headers = await this._client.getHeaders();
      const formData = new FormData();
      formData.append('file', file instanceof ArrayBuffer ? new Blob([file]) : file);
      formData.append('path', path);
      const res = await fetch(`${this._client.baseUrl}/api/storage/${this._bucket}/upload`, {
        method: 'POST',
        headers,
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        return { data: null, error: { message: err.error ?? res.statusText } };
      }
      const data = await res.json();
      return { data: { path: data.path ?? path }, error: null };
    } catch (e: any) {
      return { data: null, error: { message: e.message } };
    }
  }

  async download(path: string): Promise<{ data: Blob | null; error: any }> {
    try {
      const headers = await this._client.getHeaders();
      const res = await fetch(
        `${this._client.baseUrl}/api/storage/${this._bucket}/download?path=${encodeURIComponent(path)}`,
        { headers },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        return { data: null, error: { message: err.error ?? res.statusText } };
      }
      return { data: await res.blob(), error: null };
    } catch (e: any) {
      return { data: null, error: { message: e.message } };
    }
  }

  async remove(paths: string[]): Promise<{ data: any; error: any }> {
    try {
      const headers = await this._client.getHeaders();
      headers['Content-Type'] = 'application/json';
      const res = await fetch(`${this._client.baseUrl}/api/storage/${this._bucket}/remove`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ paths }),
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
}

class StorageClient {
  private _client: GullersClient;

  constructor(client: GullersClient) {
    this._client = client;
  }

  from(bucket: string): StorageBucketClient {
    return new StorageBucketClient(bucket, this._client);
  }
}

// ── Realtime (stub — subscribe returns noop so code doesn't break) ──────

class RealtimeChannel {
  private _name: string;

  constructor(name: string) {
    this._name = name;
  }

  on(_event: string, _filter: any, callback?: Function): this {
    // Realtime not yet implemented — silently ignore subscriptions
    return this;
  }

  subscribe(callback?: (status: string) => void): this {
    callback?.('SUBSCRIBED');
    return this;
  }

  unsubscribe(): void {}
}

// ── Main client ─────────────────────────────────────────────────────────

export class GullersClient {
  readonly baseUrl: string;
  private _apiKey?: string;
  private _tokenProvider?: AuthProvider;
  private _appId?: string;
  private _auth: AuthClient;
  private _storage: StorageClient;
  private _channels: Map<string, RealtimeChannel> = new Map();

  constructor(opts: GullersClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this._apiKey = opts.apiKey;
    this._tokenProvider = opts.tokenProvider;
    this._appId = opts.appId;
    this._auth = new AuthClient(this);
    this._storage = new StorageClient(this);
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
    if (this._appId) headers['X-App-Id'] = this._appId;
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

  get auth(): AuthClient {
    return this._auth;
  }

  get storage(): StorageClient {
    return this._storage;
  }

  /** Create a realtime channel (stub — subscriptions are silently ignored). */
  channel(name: string): RealtimeChannel {
    const ch = new RealtimeChannel(name);
    this._channels.set(name, ch);
    return ch;
  }

  removeChannel(channel: RealtimeChannel): void {
    channel.unsubscribe();
  }
}

export function createClient(opts: GullersClientOptions): GullersClient {
  return new GullersClient(opts);
}
