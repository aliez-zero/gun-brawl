import type { CharacterAppearance, CharacterStyle, Headwear } from '../game/core/types';

export const OUTFIT_COLORS = [
  { value: 0xb8663d, name: '赤陶' }, { value: 0x4e8d91, name: '松石' },
  { value: 0x6464a8, name: '鸢尾' }, { value: 0xc9a34f, name: '流金' },
  { value: 0x8e465d, name: '酒红' }, { value: 0x466b54, name: '苔绿' },
  { value: 0xc4c9cf, name: '月白' }, { value: 0x3b465b, name: '墨蓝' },
] as const;
export const SKIN_TONES = [
  { value: 0xe7b58e, name: '暖杏' }, { value: 0xbd8666, name: '麦棕' },
  { value: 0x855744, name: '深褐' },
] as const;
export const HEADWEAR: readonly { id: Headwear; name: string }[] = [
  { id: 'cowboy', name: '牛仔帽' }, { id: 'straw', name: '浪客斗笠' },
  { id: 'beret', name: '战术贝雷帽' }, { id: 'space', name: '星际头盔' },
  { id: 'knight', name: '守卫头盔' }, { id: 'none', name: '不戴头饰' },
];

export interface AppearancePreset {
  id: CharacterStyle;
  name: string;
  english: string;
  description: string;
  appearance: CharacterAppearance;
}

export const APPEARANCE_PRESETS: readonly AppearancePreset[] = [
  { id: 'cowboy', name: '荒野牛仔', english: 'DUST & GLORY', description: '宽檐帽、红领巾与皮革长衣，日落前再来一场决斗。',
    appearance: { style: 'cowboy', hat: 'cowboy', outfit: 'cowboy', color: 0xb8663d, skin: 0xe7b58e } },
  { id: 'ronin', name: '东方浪客', english: 'WANDERING BLADE', description: '斗笠、束腰与轻甲，在屋檐之间寻找下一次出手。',
    appearance: { style: 'ronin', hat: 'straw', outfit: 'ronin', color: 0x6464a8, skin: 0xbd8666 } },
  { id: 'operative', name: '都市特工', english: 'NIGHT PROTOCOL', description: '贝雷帽、护目镜与战术背心，隐入霓虹天际。',
    appearance: { style: 'operative', hat: 'beret', outfit: 'operative', color: 0x466b54, skin: 0x855744 } },
  { id: 'astronaut', name: '星际游侠', english: 'BEYOND THE ORBIT', description: '全景面罩与分层宇航服，下一站是未知星域。',
    appearance: { style: 'astronaut', hat: 'space', outfit: 'astronaut', color: 0xc4c9cf, skin: 0xe7b58e } },
  { id: 'knight', name: '古城守卫', english: 'KEEPER OF DAWN', description: '羽饰头盔、肩甲与披风，守住最后一座天空城。',
    appearance: { style: 'knight', hat: 'knight', outfit: 'knight', color: 0x4e8d91, skin: 0xbd8666 } },
];

export function presetAppearance(style: CharacterStyle): CharacterAppearance {
  return { ...APPEARANCE_PRESETS.find((preset) => preset.id === style)!.appearance };
}
export const isCharacterStyle = (value: unknown): value is CharacterStyle =>
  APPEARANCE_PRESETS.some((preset) => preset.id === value);
export const isHeadwear = (value: unknown): value is Headwear => HEADWEAR.some((hat) => hat.id === value);

export function normalizeAppearance(value: unknown, fallback: CharacterAppearance): CharacterAppearance {
  const source = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  return {
    style: isCharacterStyle(source.style) ? source.style : fallback.style,
    hat: isHeadwear(source.hat) ? source.hat : fallback.hat,
    outfit: isCharacterStyle(source.outfit) ? source.outfit : fallback.outfit,
    color: OUTFIT_COLORS.some((color) => color.value === source.color) ? source.color as number : fallback.color,
    skin: SKIN_TONES.some((tone) => tone.value === source.skin) ? source.skin as number : fallback.skin,
  };
}
