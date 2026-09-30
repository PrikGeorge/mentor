import { FormControl } from '@angular/forms';
import { passwordValidator } from './password.validator';
describe('new password validation', () => {
  it('counts Unicode scalars rather than UTF16 units', () => {
    expect(passwordValidator(new FormControl('😀'.repeat(128)))).toBeNull();
    expect(passwordValidator(new FormControl('😀'.repeat(129)))).toEqual({ password: true });
  });
  it('preserves password spaces', () => expect(passwordValidator(new FormControl('        '))).toBeNull());
  it('rejects lone surrogate sequences', () => {
    expect(passwordValidator(new FormControl('password\ud800'))).toEqual({ password: true });
    expect(passwordValidator(new FormControl('password\udc00'))).toEqual({ password: true });
  });
});
