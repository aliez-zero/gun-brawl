/**
 * Wire protocol v2, mirroring `server/crates/proto`.
 *
 * Enum variant indices must match the Rust definitions exactly; the Rust side
 * is the source of truth and its tests pin the layout.
 */
import { Reader, Writer } from './postcard';

export const PROTO_VERSION = 2;

export const SLOT_EMPTY = 0;
export const SLOT_HUMAN = 1;
export const SLOT_BOT = 2;

export const PHASE_LOBBY = 0;
export const PHASE_COUNTDOWN = 1;
export const PHASE_PLAYING = 2;
export const PHASE_RESULT = 3;

export const EVENT_SHOT = 1;
export const EVENT_HIT = 2;
export const EVENT_EXPLOSION = 3;
export const EVENT_BOMB = 4;
export const EVENT_RINGOUT = 5;
export const EVENT_RESPAWN = 6;
export const EVENT_PICKUP = 7;
export const EVENT_DROP_INCOMING = 8;
export const EVENT_DROP_LANDED = 9;
export const EVENT_DROP_EXPIRED = 10;
export const EVENT_PHASE = 11;

export const HELD_FIRE = 1 << 0;
export const EDGE_JUMP = 1 << 0;
export const EDGE_DROP = 1 << 1;
export const EDGE_BOMB = 1 << 2;
export const EDGE_RELOAD = 1 << 3;

export interface InputFrame {
  seq: number;
  tickHint: number;
  moveX: number;
  held: number;
  edges: number;
}

export interface SlotView {
  kind: number;
  player: number;
  name: string;
  ready: boolean;
  difficulty: number;
}

export interface RoomView {
  code: string;
  host: number;
  phase: number;
  map: string;
  stocks: number;
  duration: number;
  dropMode: number;
  slots: SlotView[];
  weapons: string[];
}

export interface ActorSnap {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  flags: number;
  status: number;
  stocks: number;
  weapon: number;
  ammo: number;
  reserve: number;
  fireCd: number;
  reload: number;
  protection: number;
  respawn: number;
}

export interface ProjectileSnap {
  id: number;
  owner: number;
  weapon: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface BombSnap {
  id: number;
  owner: number;
  x: number;
  y: number;
}

export interface DropSnap {
  id: number;
  weapon: number;
  x: number;
  y: number;
  state: number;
  warning: boolean;
}

export interface EventSnap {
  kind: number;
  actor: number;
  x: number;
  y: number;
}

export interface Snapshot {
  tick: number;
  serverMs: number;
  phase: number;
  remainingMs: number;
  acks: number[];
  actors: ActorSnap[];
  projectiles: ProjectileSnap[];
  bombs: BombSnap[];
  drops: DropSnap[];
  events: EventSnap[];
}

export interface MatchResultWire {
  winner: number | null;
  durationMs: number;
  overtime: boolean;
  actors: { id: number; name: string; stocks: number; knockouts: number; falls: number; selfFalls: number }[];
}

export type ServerMessage =
  | { type: 'welcome'; playerId: number; name: string; tickRate: number; snapshotRate: number }
  | { type: 'room'; room: RoomView }
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'matchEnd'; result: MatchResultWire }
  | { type: 'pong'; t: number; serverTick: number }
  | { type: 'kick'; code: number; message: string }
  | { type: 'unknown'; tag: number };

export type ClientMessage =
  | { type: 'hello'; content: number; token: string; build: string }
  | { type: 'createRoom'; name: string; map: string; stocks: number; duration: number; dropMode: number }
  | { type: 'joinRoom'; code: string; name: string }
  | { type: 'pickSlot'; slot: number; kind: number; difficulty: number }
  | { type: 'ready'; ready: boolean }
  | { type: 'start' }
  | { type: 'rematch' }
  | { type: 'input'; frames: InputFrame[] }
  | { type: 'ping'; t: number }
  | { type: 'leave' };

export function encodeClient(message: ClientMessage): Uint8Array {
  const writer = new Writer();
  switch (message.type) {
    case 'hello':
      writer.varint(0);
      writer.varint(PROTO_VERSION);
      writer.varint(message.content);
      writer.str(message.token);
      writer.str(message.build);
      break;
    case 'createRoom':
      writer.varint(1);
      writer.str(message.name);
      writer.str(message.map);
      writer.u8(message.stocks);
      writer.varint(message.duration);
      writer.u8(message.dropMode);
      break;
    case 'joinRoom':
      writer.varint(2);
      writer.str(message.code);
      writer.str(message.name);
      break;
    case 'pickSlot':
      writer.varint(3);
      writer.u8(message.slot);
      writer.u8(message.kind);
      writer.u8(message.difficulty);
      break;
    case 'ready':
      writer.varint(4);
      writer.bool(message.ready);
      break;
    case 'start':
      writer.varint(5);
      break;
    case 'rematch':
      writer.varint(6);
      break;
    case 'input':
      writer.varint(7);
      writer.varint(message.frames.length);
      for (const frame of message.frames) {
        writer.varint(frame.seq);
        writer.varint(frame.tickHint);
        writer.i8(frame.moveX);
        writer.u8(frame.held);
        writer.u8(frame.edges);
      }
      break;
    case 'ping':
      writer.varint(8);
      writer.varint(message.t);
      break;
    case 'leave':
      writer.varint(9);
      break;
  }
  return writer.finish();
}

function readVec<T>(reader: Reader, item: (reader: Reader) => T): T[] {
  const length = reader.varint();
  const items: T[] = [];
  for (let index = 0; index < length; index++) items.push(item(reader));
  return items;
}

function readActor(reader: Reader): ActorSnap {
  return {
    id: reader.u8(),
    x: reader.zigzag(),
    y: reader.zigzag(),
    vx: reader.zigzag(),
    vy: reader.zigzag(),
    facing: reader.i8(),
    flags: reader.u8(),
    status: reader.u8(),
    stocks: reader.u8(),
    weapon: reader.u8(),
    ammo: reader.u8(),
    reserve: reader.u8(),
    fireCd: reader.u8(),
    reload: reader.u8(),
    protection: reader.u8(),
    respawn: reader.u8(),
  };
}

function readProjectile(reader: Reader): ProjectileSnap {
  return {
    id: reader.u8(),
    owner: reader.u8(),
    weapon: reader.u8(),
    x: reader.zigzag(),
    y: reader.zigzag(),
    vx: reader.zigzag(),
    vy: reader.zigzag(),
  };
}

function readBomb(reader: Reader): BombSnap {
  return { id: reader.u8(), owner: reader.u8(), x: reader.zigzag(), y: reader.zigzag() };
}

function readDrop(reader: Reader): DropSnap {
  return {
    id: reader.u8(),
    weapon: reader.u8(),
    x: reader.zigzag(),
    y: reader.zigzag(),
    state: reader.u8(),
    warning: reader.bool(),
  };
}

function readEvent(reader: Reader): EventSnap {
  return { kind: reader.u8(), actor: reader.u8(), x: reader.zigzag(), y: reader.zigzag() };
}

function readRoom(reader: Reader): RoomView {
  return {
    code: reader.str(),
    host: reader.varint(),
    phase: reader.u8(),
    map: reader.str(),
    stocks: reader.u8(),
    duration: reader.varint(),
    dropMode: reader.u8(),
    slots: readVec(reader, (source) => ({
      kind: source.u8(),
      player: source.varint(),
      name: source.str(),
      ready: source.bool(),
      difficulty: source.u8(),
    })),
    weapons: readVec(reader, (source) => source.str()),
  };
}

function readSnapshot(reader: Reader): Snapshot {
  const tick = reader.varint();
  const serverMs = reader.varint();
  const phase = reader.u8();
  const remainingMs = reader.varint();
  const acks = [reader.varint(), reader.varint(), reader.varint(), reader.varint()];
  const actors = readVec(reader, readActor);
  const projectiles = readVec(reader, readProjectile);
  const bombs = readVec(reader, readBomb);
  const drops = readVec(reader, readDrop);
  const events = readVec(reader, readEvent);
  return { tick, serverMs, phase, remainingMs, acks, actors, projectiles, bombs, drops, events };
}

function readResult(reader: Reader): MatchResultWire {
  const hasWinner = reader.bool();
  const winner = hasWinner ? reader.varint() : null;
  const durationMs = reader.varint();
  const overtime = reader.bool();
  const actors = readVec(reader, (source) => ({
    id: source.varint(),
    name: source.str(),
    stocks: source.zigzag(),
    knockouts: source.varint(),
    falls: source.varint(),
    selfFalls: source.varint(),
  }));
  return { winner, durationMs, overtime, actors };
}

export function decodeServer(bytes: Uint8Array): ServerMessage {
  const reader = new Reader(bytes);
  const tag = reader.varint();
  switch (tag) {
    case 0:
      return {
        type: 'welcome',
        playerId: reader.varint(),
        name: reader.str(),
        tickRate: reader.varint(),
        snapshotRate: reader.varint(),
      };
    case 1:
      return { type: 'room', room: readRoom(reader) };
    case 2:
      return { type: 'snapshot', snapshot: readSnapshot(reader) };
    case 3:
      return { type: 'matchEnd', result: readResult(reader) };
    case 4:
      return { type: 'pong', t: reader.varint(), serverTick: reader.varint() };
    case 5:
      return { type: 'kick', code: reader.varint(), message: reader.str() };
    default:
      return { type: 'unknown', tag };
  }
}
