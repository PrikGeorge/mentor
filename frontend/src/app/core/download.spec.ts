import { REVOKE_DELAY_MS, saveBlob } from './download';

describe('Browser download', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('downloads a Blob under its name and revokes the URL only after a delay', () => {
        vi.useFakeTimers();
        const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic');
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            expect(this.download).toBe('Task.java');
            expect(this.href).toBe('blob:synthetic');
        });
        saveBlob(new Blob(['class Task {}']), 'Task.java');
        expect(create).toHaveBeenCalledTimes(1);
        expect(click).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(REVOKE_DELAY_MS - 1);
        expect(revoke).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(revoke).toHaveBeenCalledWith('blob:synthetic');
    });
});
