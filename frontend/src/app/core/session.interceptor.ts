import { inject } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { SessionStore } from './session.store';
import { EXPECTED_ACCOUNT, IDENTITY_REQUEST } from './session-context';

export function safeReturnUrl(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return null;
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith('//') || /[\\\u0000-\u0020]/.test(decoded)) return null;
  } catch { return null; }
  return value;
}

export const sessionInterceptor: HttpInterceptorFn = (request, next) => {
  if (!/^\/api\/v1(?:\/|$)/.test(request.url)) return next(request);
  const session = inject(SessionStore);
  const router = inject(Router);
  const generation = session.generation();
  const identity = request.context.get(IDENTITY_REQUEST);
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  if (mutation) {
    const anonymous = /^\/api\/v1\/auth\/(login|register|reset-password)$/.test(request.url);
    const expected = request.context.get(EXPECTED_ACCOUNT);
    const account = expected === undefined ? session.actor()?.userId : expected;
    const headers: Record<string, string> = { 'X-Mentor-Client': 'web' };
    if (session.csrfToken()) headers['X-CSRF-TOKEN'] = session.csrfToken()!;
    if (!anonymous && account) headers['X-Mentor-Account'] = account;
    request = request.clone({ setHeaders: headers });
  }
  // Same-origin relative requests use the browser's HttpOnly session cookie automatically.
  const response = next(request).pipe(catchError((error: HttpErrorResponse) => {
    const publicAuth = /^\/api\/v1\/auth\/(session|login|register|reset-password)$/.test(request.url);
    if (error.status === 401 && !publicAuth && generation === session.generation()) {
      const returnUrl = safeReturnUrl(router.url);
      session.expire(generation);
      void router.navigate(['/login'], { queryParams: returnUrl ? { returnUrl } : {} });
    }
    return throwError(() => error);
  }));
  return identity ? response : session.scope(response, generation);
};
