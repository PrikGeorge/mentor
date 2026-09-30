import { HttpContext, HttpContextToken } from '@angular/common/http';
export const IDENTITY_REQUEST = new HttpContextToken<boolean>(() => false);
export const EXPECTED_ACCOUNT = new HttpContextToken<string | null | undefined>(() => undefined);
export function identityContext(account?: string | null): HttpContext {
  return new HttpContext().set(IDENTITY_REQUEST, true).set(EXPECTED_ACCOUNT, account);
}
