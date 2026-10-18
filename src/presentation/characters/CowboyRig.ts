import type { CharacterAppearance } from '../../game/core/types';
// Compatibility names for the original cowboy sample. Anatomy now serves every outfit.
export {
  HUMANOID_PARTS as COWBOY_PARTS, HUMANOID_BONES as COWBOY_BONES,
  HumanoidMotion as CowboyMotion, humanoidSupportGrip as cowboySupportGrip,
  sampleHumanoid as sampleCowboy, previewHumanoidPose as previewCowboyPose,
  worldWeaponMount, mountedWeaponMuzzle,
} from './HumanoidRig';
export type {
  HumanoidPart as CowboyPart, HumanoidPose as CowboyPose,
  HumanoidMotionInput as CowboyMotionInput, RigPartPose, WeaponMount,
} from './HumanoidRig';
export function hasCowboyRig(look: CharacterAppearance): boolean {
  return look.style === 'cowboy' && look.outfit === 'cowboy';
}
