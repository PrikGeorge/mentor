import { Pipe, PipeTransform } from '@angular/core';
const UNITS = ['КиБ', 'МиБ', 'ГиБ'];
// Binary units with a Russian decimal comma: «512 байт», «18,6 КиБ», «1 МиБ». Matches the limits the forms quote (20 МиБ).
export function formatFileSize(bytes: number | null | undefined): string {
    if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024) return `${Math.round(bytes)} байт`;
    let value = bytes, unit = -1;
    while (value >= 1024 && unit < UNITS.length - 1) { value /= 1024; unit++; }
    return `${value.toFixed(1).replace(/\.0$/, '').replace('.', ',')} ${UNITS[unit]}`;
}
@Pipe({ name: 'fileSize' })
export class FileSizePipe implements PipeTransform {
    transform(bytes: number | null | undefined): string { return formatFileSize(bytes); }
}
