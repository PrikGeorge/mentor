import { MarkdownImport } from './markdown-import.service';
import { fileOf } from './markdown-test-support';
describe('Exact bounded Markdown import', () => {
    const importer = new MarkdownImport();
    it('preserves exact UTF8 source and significant whitespace', async () => {
        const source = '  ## Ж😀\n\n```java\n  class A {}  \n```\n';
        expect(await importer.read(fileOf(new TextEncoder().encode(source)))).toBe(source);
    });
    it('uses UTF16 limits, accepting200000 and rejecting200001', async () => {
        const exact = '😀'.repeat(100000);
        expect(await importer.read(fileOf(new TextEncoder().encode(exact)))).toBe(exact);
        await expect(importer.read(fileOf(new TextEncoder().encode(exact + 'a')))).rejects.toThrow(/200/);
    });
    it('rejects malformed UTF8 without replacement decoding', async () => {
        await expect(importer.read(fileOf(new Uint8Array([0xc3, 0x28])))).rejects.toThrow(/UTF-8/);
    });
    it('checks both declared and measured1MiB file size', async () => {
        await expect(importer.read(fileOf(new Uint8Array([65]), 'source.md', 1048577))).rejects.toThrow(/1/);
        await expect(importer.read(fileOf(new Uint8Array(1048577), 'source.md', 1))).rejects.toThrow(/1/);
    });
    it('rejects binary controls, empty input and non Markdown extension', async () => {
        for (const file of [fileOf(new Uint8Array([0])), fileOf(new TextEncoder().encode('  \n')), fileOf(new Uint8Array([65]), 'source.java')])
            await expect(importer.read(file)).rejects.toThrow();
    });
});
