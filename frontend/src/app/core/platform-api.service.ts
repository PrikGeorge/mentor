import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import type { components, paths } from '../api/schema';

export type Actor = components['schemas']['Actor'];
export type SessionView = components['schemas']['Session'];
type Method = 'get' | 'post' | 'patch' | 'delete';
type PathFor<M extends Method> = { [P in keyof paths]: paths[P][M] extends undefined ? never : P }[keyof paths];
type Operation<P extends keyof paths, M extends Method> = NonNullable<paths[P][M]>;
type Json<C> = C extends { content: { 'application/json': infer T } } ? T : void;
type Success<O> = O extends { responses: infer R } ? R extends { 200: infer C } ? Json<C> : R extends { 201: infer C } ? Json<C> : void : never;
type Body<O> = O extends { requestBody: infer B } ? Json<B> : never;
type Options = { context?: HttpContext; pathParams?: Record<string, string>; query?: Record<string, string | number> };

@Injectable({ providedIn: 'root' })
export class PlatformApi {
  private readonly http = inject(HttpClient);
  get<P extends PathFor<'get'>>(path: P, options: Options = {}): Observable<Success<Operation<P, 'get'>>> {
    return this.send('GET', path, undefined, options);
  }
  post<P extends PathFor<'post'>>(path: P, body: Body<Operation<P, 'post'>>, options: Options = {}): Observable<Success<Operation<P, 'post'>>> {
    return this.send('POST', path, body, options);
  }
  patch<P extends PathFor<'patch'>>(path: P, body: Body<Operation<P, 'patch'>>, options: Options = {}): Observable<Success<Operation<P, 'patch'>>> {
    return this.send('PATCH', path, body, options);
  }
  delete<P extends PathFor<'delete'>>(path: P, options: Options = {}): Observable<Success<Operation<P, 'delete'>>> {
    return this.send('DELETE', path, undefined, options);
  }
  private send<T>(method: string, path: string, body: unknown, options: Options): Observable<T> {
    const resolved = path.replace(/\{([^}]+)\}/g, (_match, key: string) => {
      const value = options.pathParams?.[key];
      if (!value) throw new Error(`Missing path parameter: ${key}`);
      return encodeURIComponent(value);
    });
    return this.http.request<T>(method, `/api/v1${resolved}`, { body, context: options.context, params: new HttpParams({ fromObject: options.query }) });
  }
}
