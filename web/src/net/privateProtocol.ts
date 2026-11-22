import type { Writer } from './postcard';
import type { InputFrame } from './protocol';

export interface PrivateMatch {
  mode: string;
  map: string;
  stocks: number;
  duration: number;
  dropMode: number;
  seed: number;
  actors: { name: string; kind: number; difficulty: number }[];
  trainingCompleted: number;
  campaignLevel?: string;
}

export type PrivateAction =
  | { type: 'pause' | 'resume' | 'resetTraining' }
  | { type: 'setDummy'; moving: boolean }
  | { type: 'selectWeapon'; weapon: string }
  | { type: 'external'; actor: number; epoch: number; sequence: number; observationTick: number; hold: number; input: InputFrame; intent: number };

export function writePrivateMatch(writer: Writer, match: PrivateMatch): void {
  writer.str(match.mode);
  writer.str(match.map);
  writer.u8(match.stocks);
  writer.varint(match.duration);
  writer.u8(match.dropMode);
  writer.varint(match.seed);
  writer.varint(match.actors.length);
  for (const actor of match.actors) {
    writer.str(actor.name);
    writer.u8(actor.kind);
    writer.u8(actor.difficulty);
  }
  writer.u8(match.trainingCompleted);
  writer.bool(match.campaignLevel !== undefined);
  if (match.campaignLevel !== undefined) writer.str(match.campaignLevel);
}

export function writePrivateAction(writer: Writer, action: PrivateAction, writeInput: (target: Writer, frame: InputFrame) => void): void {
  switch (action.type) {
    case 'pause': writer.varint(0); break;
    case 'resume': writer.varint(1); break;
    case 'resetTraining': writer.varint(2); break;
    case 'setDummy': writer.varint(3); writer.bool(action.moving); break;
    case 'selectWeapon': writer.varint(4); writer.str(action.weapon); break;
    case 'external':
      writer.varint(5);
      writer.u8(action.actor);
      writer.varint(action.epoch);
      writer.varint(action.sequence);
      writer.varint(action.observationTick);
      writer.u8(action.hold);
      writeInput(writer, action.input);
      writer.u8(action.intent);
      break;
  }
}
