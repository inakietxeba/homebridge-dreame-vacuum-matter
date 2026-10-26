import { HA_CAPABILITIES } from './ha-capabilities.generated.js';

export interface DreameCapabilities {
  knownModel: boolean;
  cleanGenius?: boolean;
  liftingMopPads?: boolean;
  embeddedTank?: boolean;
  newState?: boolean;
  gen5?: boolean;
  cleaningModeSupported?: boolean;
  customizedCleaningSupported?: boolean;
  waterTankInstalled?: boolean;
}

export function resolveCapabilities(model: string, firmware: string): DreameCapabilities {
  const series = model.split('.').at(-1) ?? '';
  const index = /^(dreame|mova|trouver)\.vacuum\./.test(model) ? HA_CAPABILITIES.models[series] : undefined;
  const profile = index === undefined ? undefined : HA_CAPABILITIES.profiles[index];
  if (!profile) return { knownModel: false };
  const buildText = firmware.match(/(?:^|_)(\d+)$/)?.[1];
  const build = buildText === undefined ? undefined : Number(buildText);
  const enabled = (name: string): boolean => {
    const threshold = profile[HA_CAPABILITIES.flags.indexOf(name)];
    return threshold !== undefined && threshold !== null && (threshold <= 1 || (build !== undefined && build >= threshold));
  };
  return {
    knownModel: true,
    cleanGenius: enabled('CLEANGENIUS'),
    liftingMopPads: enabled('MOP_PAD_LIFTING') || enabled('MOP_PAD_LIFTING_PLUS') || enabled('MOP_PAD_UNMOUNTING'),
    embeddedTank: enabled('EMBEDDED_TANK'),
    newState: enabled('NEW_STATE'),
    gen5: enabled('GEN5') || /^(mova|trouver)\.vacuum\./.test(model),
  };
}

// HA translates the pre-NEW_STATE enum into its canonical state enum.
const LEGACY_STATE: Record<number, number> = { 19: 23, 20: 20, 21: 98, 23: 21, 24: 22, 25: 19, 26: 24 };

export function normalizeDeviceState(raw: number, capabilities: DreameCapabilities): number {
  return capabilities.newState === false ? LEGACY_STATE[raw] ?? raw : raw;
}
