import { initialOf, moscowDate } from './format';

describe('Shared format helpers', () => {
    it('takes the first letter of a name in upper case, or a dot for a blank name', () => {
        expect(initialOf('  анна Петрова')).toBe('А');
        expect(initialOf('   ')).toBe('·');
    });

    it('gives the Moscow calendar date even when it is still yesterday in UTC', () => {
        expect(moscowDate(Date.parse('2026-10-15T21:30:00Z'))).toBe('2026-10-16');
        expect(moscowDate(Date.parse('2026-10-15T20:30:00Z'))).toBe('2026-10-15');
    });
});
