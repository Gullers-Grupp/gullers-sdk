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
    error: {
        message: string;
    } | null;
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
declare class QueryBuilder<T = any> {
    private _table;
    private _client;
    private _select;
    private _filters;
    private _order;
    private _limit;
    private _offset;
    private _method;
    private _body;
    private _single;
    constructor(table: string, client: GullersClient);
    select(columns?: string): this;
    insert(data: Partial<T> | Partial<T>[]): this;
    update(data: Partial<T>): this;
    delete(): this;
    eq(column: string, value: string | number | boolean): this;
    neq(column: string, value: string | number | boolean): this;
    gt(column: string, value: string | number): this;
    gte(column: string, value: string | number): this;
    lt(column: string, value: string | number): this;
    lte(column: string, value: string | number): this;
    like(column: string, pattern: string): this;
    ilike(column: string, pattern: string): this;
    is(column: string, value: 'null' | 'true' | 'false'): this;
    in(column: string, values: (string | number)[]): this;
    not(column: string, op: 'is', value: string): this;
    order(column: string, opts?: {
        ascending?: boolean;
    }): this;
    limit(n: number): this;
    offset(n: number): this;
    single(): this;
    maybeSingle(): this;
    execute(): Promise<QueryResult<T>>;
    then<R>(resolve: (value: QueryResult<T>) => R, reject?: (reason: any) => R): Promise<R>;
}
export declare class GullersClient {
    readonly baseUrl: string;
    private _apiKey?;
    private _tokenProvider?;
    constructor(opts: GullersClientOptions);
    /** Build auth headers. API key takes precedence; falls back to token provider. */
    getHeaders(): Promise<Record<string, string>>;
    from<T = any>(table: string): QueryBuilder<T>;
    rpc<T = any>(fn: string, args?: Record<string, any>): Promise<QueryResult<T>>;
    get functions(): {
        invoke: <T = any>(fn: string, opts?: {
            body?: any;
        }) => Promise<QueryResult<T>>;
    };
}
export declare function createClient(opts: GullersClientOptions): GullersClient;
export {};
