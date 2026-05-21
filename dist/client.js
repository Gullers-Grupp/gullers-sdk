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
export class GullersClient {
    baseUrl;
    _apiKey;
    _tokenProvider;
    constructor(opts) {
        this.baseUrl = opts.baseUrl.replace(/\/$/, '');
        this._apiKey = opts.apiKey;
        this._tokenProvider = opts.tokenProvider;
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
}
export function createClient(opts) {
    return new GullersClient(opts);
}
