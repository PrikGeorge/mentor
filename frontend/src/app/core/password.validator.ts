import { AbstractControl, ValidationErrors } from '@angular/forms';
export function passwordValidator(control: AbstractControl): ValidationErrors | null {
  const value = String(control.value ?? '');
  const count = Array.from(value).length;
  if (count < 8 || count > 128 || new TextEncoder().encode(value).length > 512) return { password: true };
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return { password: true };
    } else if (code >= 0xdc00 && code <= 0xdfff) return { password: true };
  }
  return null;
}
