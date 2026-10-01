export type EditState = { value: string; start: number; end: number };
export function transform(state: EditState, command: string): EditState {
    const { value } = state, start = Math.max(0, Math.min(value.length, state.start)), end = Math.max(start, Math.min(value.length, state.end));
    const selected = value.slice(start, end);
    const insert = (text: string, offset: number, length: number) => ({ value: value.slice(0, start) + text + value.slice(end), start: start + offset, end: start + offset + length });
    if (command === 'bold' || command === 'italic') {
        const marker = command === 'bold' ? '**' : '*';
        if (start >= marker.length && value.slice(start-marker.length,start) === marker && value.slice(end,end+marker.length) === marker) return { value: value.slice(0,start-marker.length)+selected+value.slice(end+marker.length), start: start-marker.length, end: end-marker.length };
        const text = selected || 'текст'; return insert(marker+text+marker, marker.length, text.length);
    }
    if (command === 'link') { const label = (selected || 'текст ссылки').replace(/([\[\]\\])/g,'\\$1'); return insert('['+label+'](https://example.com)', label.length+3, 19); }
    if (command === 'code' || command === 'table') {
        const before = value.slice(0,start), after = value.slice(end), lead = before ? (/\n\n$/.test(before)?'':/\n$/.test(before)?'\n':'\n\n') : '', tail = after ? (/^\n\n/.test(after)?'':/^\n/.test(after)?'\n':'\n\n') : '';
        if (command === 'table') return insert(lead+'| Заголовок | Описание |\n| --- | --- |\n| Значение | Текст |'+tail,lead.length+2,9);
        const code = selected || '// Ваш код', fence = '`'.repeat(Math.max(3,...Array.from(code.matchAll(/`+/g),m=>m[0].length+1)));
        return insert(lead+fence+'java\n'+code+'\n'+fence+tail,lead.length+fence.length+5,code.length);
    }
    if (['heading','bullet','numbered','quote'].includes(command)) {
        const lineStart = start === 0 ? 0 : value.lastIndexOf('\n',start-1)+1, last = end > start && value[end-1] === '\n' ? end-1 : end;
        let lineEnd = value.indexOf('\n',last); if (lineEnd < 0) lineEnd = value.length;
        const lines = value.slice(lineStart,lineEnd).split('\n'), pattern = command === 'heading' ? /^#{1,6} +/ : command === 'bullet' ? /^[-+*] +/ : command === 'numbered' ? /^\d+[.)] +/ : /^> ?/;
        const off = lines.every(line => command === 'heading' ? /^## +/.test(line) : pattern.test(line));
        const text = lines.map((line,index) => (off ? '' : command === 'heading' ? '## ' : command === 'bullet' ? '- ' : command === 'numbered' ? (index+1)+'. ' : '> ')+line.replace(pattern,'')).join('\n');
        return { value: value.slice(0,lineStart)+text+value.slice(lineEnd), start: lineStart, end: lineStart+text.length };
    }
    return state;
}
