export function fileOf(bytes: Uint8Array, name = 'source.md', declaredSize = bytes.byteLength): File {
    return { name, size: declaredSize, arrayBuffer: async () => bytes.slice().buffer } as File;
}
