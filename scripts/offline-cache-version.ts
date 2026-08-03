import { createHash } from 'node:crypto';

export function deriveOfflineWorkerLogicDigest(
  sources: readonly (Uint8Array | string)[],
): string {
  const digest = createHash('sha256');
  for (const source of sources) {
    digest.update(
      String(typeof source === 'string' ? Buffer.byteLength(source) : source.byteLength),
    );
    digest.update('\0');
    digest.update(source);
    digest.update('\0');
  }
  return digest.digest('hex');
}

export function deriveOfflineCacheVersion({
  manifestDigest,
  configDigest,
  base,
  assets,
}: {
  readonly manifestDigest: string;
  readonly configDigest: string;
  readonly base: string;
  readonly assets: readonly {
    readonly path: string;
    readonly bytes: Uint8Array | string;
  }[];
}): string {
  const assetDigest = createHash('sha256');
  for (const asset of assets) {
    assetDigest.update(asset.path);
    assetDigest.update('\0');
    assetDigest.update(asset.bytes);
  }
  return createHash('sha256')
    .update(manifestDigest)
    .update('\0')
    .update(assetDigest.digest('hex'))
    .update('\0')
    .update(configDigest)
    .update('\0')
    .update(base)
    .digest('hex')
    .slice(0, 24);
}

export default deriveOfflineCacheVersion;
