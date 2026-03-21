export const ENDGAME_VALUES = {
  none: 0,
  level1: 15,
  level2: 20,
  level3: 30
};

export const VALID_ALLIANCE = new Set(['red', 'blue']);
export const VALID_ENDGAME = new Set(['none', 'level1', 'level2', 'level3']);

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const toBool = (value) => {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').toLowerCase().trim();
  return ['1', 'true', 'yes', 'y', 'x'].includes(normalized);
};
