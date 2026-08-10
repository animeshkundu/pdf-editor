import type { EngineTypes } from '@/lib/engine/port';

export default function FeatureBadge({
  status,
}: {
  readonly status: EngineTypes['FeatureStatus'];
}) {
  return (
    <span className={`status-badge product-status status-${status.toLocaleLowerCase()}`}>
      {status}
    </span>
  );
}
