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
class QueryBuilder {
    _table;
    _client;
    _select = null;
    _filters = [];
    _order = [];
    _limit = null;
    _offset = null;
    _method = 'GET';
    _body = null;
    _single = false;
    constructor(table, client) {
        this._table = table;
        this._client = client;
    }
    select(columns = '*') {
        this._select = columns;
        this._method = 'GET';
        return this;
    }
    insert(data) {
        this._method = 'POST';
        this._body = data;
        return this;
    }
    update(data) {
        this._method = 'PUT';
        this._body = data;
        return this;
    }
    delete() {
        this._method = 'DELETE';
        return this;
    }
    eq(column, value) {
        this._filters.push({ column, op: 'eq', value: String(value) });
        return this;
    }
    neq(column, value) {
        this._filters.push({ column, op: 'neq', value: String(value) });
        return this;
    }
    gt(column, value) {
        this._filters.push({ column, op: 'gt', value: String(value) });
        return this;
    }
    gte(column, value) {
        this._filters.push({ column, op: 'gte', value: String(value) });
        return this;
    }
    lt(column, value) {
        this._filters.push({ column, op: 'lt', value: String(value) });
        return this;
    }
    lte(column, value) {
        this._filters.push({ column, op: 'lte', value: String(value) });
        return this;
    }
    like(column, pattern) {
        this._filters.push({ column, op: 'like', value: pattern });
        return this;
    }
    ilike(column, pattern) {
        this._filters.push({ column, op: 'ilike', value: pattern });
        return this;
    }
    is(column, value) {
        this._filters.push({ column, op: 'is', value });
        return this;
    }
    in(column, values) {
        this._filters.push({ column, op: 'in', value: `(${values.join(',')})` });
        return this;
    }
    not(column, op, value) {
        if (op === 'is' && value === 'null') {
            this._filters.push({ column, op: 'neq', value: 'null' });
        }
        return this;
    }
    order(column, opts) {
        this._order.push({ column, ascending: opts?.ascending ?? true });
        return this;
    }
    limit(n) {
        this._limit = n;
        return this;
    }
    offset(n) {
        this._offset = n;
        return this;
    }
    single() {
        this._single = true;
        this._limit = 1;
        return this;
    }
    maybeSingle() {
        this._single = true;
        this._limit = 1;
        return this;
    }
    async execute() {
        try {
            const params = new URLSearchParams();
            if (this._select)
                params.set('select', this._select);
            for (const f of this._filters) {
                params.set(f.column, `${f.op}.${f.value}`);
            }
            if (this._order.length) {
                params.set('order', this._order.map((o) => `${o.column}.${o.ascending ? 'asc' : 'desc'}`).join(','));
            }
            if (this._limit !== null)
                params.set('limit', String(this._limit));
            if (this._offset !== null)
                params.set('offset', String(this._offset));
            const qs = params.toString();
            const url = `${this._client.baseUrl}/api/data/${this._table}${qs ? '?' + qs : ''}`;
            const headers = await this._client.getHeaders();
            if (this._body)
                headers['Content-Type'] = 'application/json';
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
        }
        catch (e) {
            return { data: null, error: { message: e.message } };
        }
    }
    then(resolve, reject) {
        return this.execute().then(resolve, reject);
    }
}
class AuthClient {
    _client;
    _session = null;
    _listeners = new Set();
    constructor(client) {
        this._client = client;
    }
    _notify(event, session) {
        this._session = session;
        this._listeners.forEach((cb) => cb(event, session));
    }
    async signInWithPassword(creds) {
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
        }
        catch (e) {
            return { data: { session: null, user: null }, error: { message: e.message } };
        }
    }
    async signOut(opts) {
        try {
            const headers = await this._client.getHeaders();
            await fetch(`${this._client.baseUrl}/api/auth/sign-out`, {
                method: 'POST',
                headers,
            }).catch(() => { });
            this._notify('SIGNED_OUT', null);
            return { error: null };
        }
        catch (e) {
            this._notify('SIGNED_OUT', null);
            return { error: { message: e.message } };
        }
    }
    async getSession() {
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
        }
        catch (e) {
            return { data: { session: null }, error: { message: e.message } };
        }
    }
    async getUser() {
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
        }
        catch (e) {
            return { data: { user: null }, error: { message: e.message } };
        }
    }
    onAuthStateChange(callback) {
        this._listeners.add(callback);
        // Fire immediately with current state
        if (this._session)
            callback('SIGNED_IN', this._session);
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
    _bucket;
    _client;
    constructor(bucket, client) {
        this._bucket = bucket;
        this._client = client;
    }
    async upload(path, file) {
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
        }
        catch (e) {
            return { data: null, error: { message: e.message } };
        }
    }
    async download(path) {
        try {
            const headers = await this._client.getHeaders();
            const res = await fetch(`${this._client.baseUrl}/api/storage/${this._bucket}/download?path=${encodeURIComponent(path)}`, { headers });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: res.statusText }));
                return { data: null, error: { message: err.error ?? res.statusText } };
            }
            return { data: await res.blob(), error: null };
        }
        catch (e) {
            return { data: null, error: { message: e.message } };
        }
    }
    async remove(paths) {
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
        }
        catch (e) {
            return { data: null, error: { message: e.message } };
        }
    }
}
class StorageClient {
    _client;
    constructor(client) {
        this._client = client;
    }
    from(bucket) {
        return new StorageBucketClient(bucket, this._client);
    }
}
// ── Realtime (stub — subscribe returns noop so code doesn't break) ──────
class RealtimeChannel {
    _name;
    constructor(name) {
        this._name = name;
    }
    on(_event, _filter, callback) {
        // Realtime not yet implemented — silently ignore subscriptions
        return this;
    }
    subscribe(callback) {
        callback?.('SUBSCRIBED');
        return this;
    }
    unsubscribe() { }
}
// ── Main client ─────────────────────────────────────────────────────────
export class GullersClient {
    baseUrl;
    _apiKey;
    _tokenProvider;
    _auth;
    _storage;
    _channels = new Map();
    constructor(opts) {
        this.baseUrl = opts.baseUrl.replace(/\/$/, '');
        this._apiKey = opts.apiKey;
        this._tokenProvider = opts.tokenProvider;
        this._auth = new AuthClient(this);
        this._storage = new StorageClient(this);
    }
    /** Build auth headers. API key takes precedence; falls back to token provider. */
    async getHeaders() {
        const headers = {};
        if (this._apiKey) {
            headers['Authorization'] = `Bearer ${this._apiKey}`;
        }
        else if (this._tokenProvider) {
            const token = await this._tokenProvider();
            if (token)
                headers['Authorization'] = `Bearer ${token}`;
        }
        return headers;
    }
    from(table) {
        return new QueryBuilder(table, this);
    }
    async rpc(fn, args) {
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
        }
        catch (e) {
            return { data: null, error: { message: e.message } };
        }
    }
    get functions() {
        return {
            invoke: async (fn, opts) => {
                return this.rpc(fn, opts?.body);
            },
        };
    }
    get auth() {
        return this._auth;
    }
    get storage() {
        return this._storage;
    }
    /** Create a realtime channel (stub — subscriptions are silently ignored). */
    channel(name) {
        const ch = new RealtimeChannel(name);
        this._channels.set(name, ch);
        return ch;
    }
    removeChannel(channel) {
        channel.unsubscribe();
    }
}
export function createClient(opts) {
    return new GullersClient(opts);
}
