// FE-14/FE-21: one way to hand the user a file built in the browser. The object URL is revoked only after the
// browser had time to start the download; revoking it at once can cancel the download in some browsers.
export const REVOKE_DELAY_MS = 60_000;

export function saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
