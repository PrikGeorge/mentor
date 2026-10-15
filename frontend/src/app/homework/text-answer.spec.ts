import { answerBytes, answerFile, answerFilename, answerSize, validateAnswer } from './text-answer';
import { validateHomework } from './homework-api.service';
describe('Typed homework answer', () => {
    it('names Java after its first public type and falls back to Main.java', () => {
        expect(answerFilename('import java.util.*;\n\npublic class Library {}', 'java')).toBe('Library.java');
        expect(answerFilename('public sealed interface Shape permits Circle {}', 'java')).toBe('Shape.java');
        expect(answerFilename('public record Point(int x, int y) {}', 'java')).toBe('Point.java');
        expect(answerFilename('public abstract static class Задача {}', 'java')).toBe('Задача.java');
        expect(answerFilename('class Hidden {}\nint x = 1;', 'java')).toBe('Main.java');
        expect(answerFilename('public class ' + 'A'.repeat(121) + ' {}', 'java')).toBe('Main.java');
        expect(answerFilename('public class Library {}', 'md')).toBe('answer.md');
    });
    it('measures UTF-8 bytes against the 256 KiB code-view limit', () => {
        expect(answerBytes('ж')).toBe(2);
        expect(validateAnswer(' \n\t')).toBe('Напиши ответ или переключись на файл.');
        expect(validateAnswer('a'.repeat(262144))).toBeNull();
        expect(validateAnswer('a'.repeat(262145))).toBe('Ответ больше 256 КиБ. Сдай его файлом или архивом.');
        expect(answerSize(0)).toBe('0 КиБ из 256 КиБ');
        expect(answerSize(12697)).toBe('12,4 КиБ из 256 КиБ');
        expect(answerSize(204800)).toBe('200 КиБ из 256 КиБ');
    });
    it('builds a file the ordinary homework validation accepts', async () => {
        const file = answerFile('public class Library {}\n', 'java');
        expect(file.name).toBe('Library.java');
        expect(await file.text()).toBe('public class Library {}\n');
        expect(validateHomework(file, '', '')).toBeNull();
        expect(validateHomework(answerFile('# Ответ', 'md'), '', '')).toBeNull();
    });
});
