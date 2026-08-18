export interface DeviceLabel {
  detail: string;
  name: string;
  title: string;
}

export interface DeviceOption extends DeviceLabel {
  deviceId: string;
}

const HARDWARE_ID_SUFFIX = /\s+\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/iu;
const DUPLICATED_NAME_SUFFIX = /^(.*?)\s+\((.*?)\)\s*$/u;
const LABEL_PREFIX = /^(default|padr[aã]o|communications|comunicaç(?:ão|ões))\s*[-—:]\s*/iu;

function removeTechnicalSuffix(label: string): string {
  return label.replace(HARDWARE_ID_SUFFIX, '').trim();
}

function removeDuplicatedName(label: string): string {
  const match = DUPLICATED_NAME_SUFFIX.exec(label);
  if (!match) return label;
  const [, name = '', suffix = ''] = match;
  return name.trim().localeCompare(suffix.trim(), undefined, { sensitivity: 'accent' }) === 0
    ? name.trim()
    : label;
}

export function normalizeDeviceLabel(label: string, fallback: string): Omit<DeviceLabel, 'title'> {
  const cleanLabel = removeTechnicalSuffix(label) || fallback;
  const prefix = LABEL_PREFIX.exec(cleanLabel)?.[1]?.toLocaleLowerCase('pt-BR');
  if (!prefix) return { detail: '', name: removeDuplicatedName(cleanLabel) };

  const name = removeDuplicatedName(cleanLabel.replace(LABEL_PREFIX, '').trim()) || fallback;
  const detail =
    prefix.startsWith('communication') || prefix.startsWith('comunica') ? 'Comunicações' : 'Padrão';
  return { detail, name };
}

export function describeMediaDevices(
  devices: MediaDeviceInfo[],
  fallbackLabel: string,
): DeviceOption[] {
  const normalized = devices.map((device, index) => ({
    device,
    normalized: normalizeDeviceLabel(device.label, `${fallbackLabel} ${index + 1}`),
  }));
  const totals = new Map<string, number>();
  for (const item of normalized) {
    const key = `${item.normalized.detail}\u0000${item.normalized.name}`;
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }
  const occurrences = new Map<string, number>();

  return normalized.map(({ device, normalized: item }) => {
    const key = `${item.detail}\u0000${item.name}`;
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    const duplicateSuffix = (totals.get(key) ?? 0) > 1 ? ` ${occurrence}` : '';
    const name = `${item.name}${duplicateSuffix}`;
    return {
      deviceId: device.deviceId,
      detail: item.detail,
      name,
      title: item.detail ? `${item.detail} — ${name}` : name,
    };
  });
}
