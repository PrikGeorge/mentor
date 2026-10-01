import { Injectable } from '@angular/core';
@Injectable({ providedIn: 'root' })
export class MarkdownImport {
    async read(file: File): Promise<string> {
        if (!file || !/\.(md|markdown)$/i.test(file.name)) throw new Error('Выберите Markdown-файл .md или .markdown.');
        if (file.size > 1048576) throw new Error('Файл слишком большой: допустимо до 1 МиБ.');
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.byteLength > 1048576) throw new Error('Файл слишком большой: допустимо до 1 МиБ.');
        let text: string;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('Не удалось прочитать UTF-8. Сохраните файл в кодировке UTF-8.'); }
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error('Похоже, это бинарный файл. Выберите текстовый Markdown.');
        if (text.length > 200000) throw new Error('В тексте может быть не больше 200 000 символов.');
        if (!text.trim()) throw new Error('Файл пуст. Выберите файл с текстом.');
        return text;
    }
}
