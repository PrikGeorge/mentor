// A work typed into the form travels as an ordinary single-file submission, so the server, the code view and line
// comments treat it exactly like an uploaded .java or .md file (T13).
export type AnswerFormat = 'java' | 'md';
// The inline code view and line comments accept a single text file up to 256 KiB; a longer answer goes as a file.
export const MAXIMUM_ANSWER_BYTES = 262144;
const declaration = /\bpublic\s+(?:(?:abstract|final|sealed|non-sealed|static|strictfp)\s+)*(?:class|record|interface|enum)\s+([\p{L}_$][\p{L}\p{N}_$]*)/u;
export function answerBytes(text: string) {
    return new TextEncoder().encode(text).length;
}
// Java keeps the name of its first public type so the file compiles as is; everything else is answer.md.
export function answerFilename(text: string, format: AnswerFormat) {
    if (format === 'md') return 'answer.md';
    const name = declaration.exec(text)?.[1];
    return name && name.length <= 120 ? name + '.java' : 'Main.java';
}
export function validateAnswer(text: string): string | null {
    if (!text.trim()) return 'Напиши ответ или переключись на файл.';
    if (answerBytes(text) > MAXIMUM_ANSWER_BYTES) return 'Ответ больше 256 КиБ. Сдай его файлом или архивом.';
    return null;
}
export function answerFile(text: string, format: AnswerFormat) {
    return new File([text], answerFilename(text, format), { type: format === 'java' ? 'text/x-java' : 'text/markdown' });
}
// «12,4 КиБ из 256 КиБ»: one decimal below 100 KiB, whole numbers above.
export function answerSize(bytes: number) {
    const kib = bytes / 1024;
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: kib < 100 ? 1 : 0 }).format(kib) + ' КиБ из 256 КиБ';
}
