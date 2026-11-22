import { presetAppearance } from '../content/appearances';
import { getArena } from '../content/maps';
import { createTrainingState, TRAINING_TASKS } from '../content/tutorial';
import { BASIC_PISTOL } from '../content/weapons';
import { createActor } from '../game/core/actors';
import type { ActorConfig, Difficulty, DropMode, MatchConfig, MatchState } from '../game/core/types';
import { randomId } from '../ids';
import { SLOT_BOT, SLOT_EMPTY, type PrivateMatch, type RoomView } from './protocol';

const difficulties: readonly Difficulty[] = ['easy', 'normal', 'hard'];
const dropModes: readonly DropMode[] = ['all', 'standard', 'none'];
const styles = ['cowboy', 'ronin', 'operative', 'astronaut', 'knight'] as const;

function privateActor(actor: ActorConfig): PrivateMatch['actors'][number] {
  switch (actor.control) {
    case 'human': return { name: actor.name, kind: actor.inputSlot, difficulty: 1 };
    case 'bot': return { name: actor.name, kind: 3, difficulty: difficulties.indexOf(actor.difficulty) };
    case 'dummy': return { name: actor.name, kind: 4, difficulty: 1 };
    case 'external': return { name: actor.name, kind: 5, difficulty: 1 };
  }
}

export function privateSetup(config: MatchConfig): PrivateMatch {
  return {
    mode: config.mode,
    map: config.map.id,
    stocks: config.stocks,
    duration: Math.round(config.duration),
    dropMode: dropModes.indexOf(config.dropMode ?? 'all'),
    seed: config.seed >>> 0,
    actors: config.actors.map(privateActor),
    trainingCompleted: TRAINING_TASKS.reduce((bits, task, index) =>
      config.trainingCompleted?.includes(task.id) ? bits | (1 << index) : bits, 0),
    campaignLevel: config.campaignLevelId,
  };
}

export function sharedMatchConfig(room: RoomView): MatchConfig {
  const actors = room.slots.filter((slot) => slot.kind !== SLOT_EMPTY).map((slot, index): ActorConfig => {
    const look = { id: `p${index}`, name: slot.name, color: 0xffffff, appearance: presetAppearance(styles[index % styles.length]!) };
    if (slot.kind === SLOT_BOT) return { ...look, control: 'bot', difficulty: difficulties[slot.difficulty] ?? 'normal' };
    return { ...look, control: 'human', inputSlot: index % 2 === 0 ? 1 : 2 };
  });
  return {
    mode: 'custom', matchId: `online-${room.code}-${randomId()}`, map: getArena(room.map), actors,
    startingWeapon: BASIC_PISTOL, stocks: room.stocks, duration: room.duration,
    countdown: 3, seed: 0, dropMode: dropModes[room.dropMode] ?? 'all',
  };
}

export function initialMatchState(config: MatchConfig): MatchState {
  const { map, startingWeapon, stocks } = config;
  return {
    config, phase: 'countdown', remaining: config.duration, countdownRemaining: config.countdown,
    actors: config.actors.map((actor, index) => createActor(actor, map.spawns[index] ?? map.spawns[0]!, stocks, map.width / 2, startingWeapon)),
    projectiles: [], bombs: [], drops: [], elapsed: 0, overtime: false, result: null,
    ...(config.mode === 'training' && { training: createTrainingState(config.trainingCompleted) }),
  };
}
