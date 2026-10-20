/**
 * Minimal postcard reader/writer for the messages in `protocol.ts`.
 *
 * Postcard encodes integers as LEB128 varints (signed values zigzag first),
 * strings as a varint length plus UTF-8, and enums as a varint variant index.
 * Only the shapes the game actually sends are implemented.
 */
export class Writer {
  private readonly bytes: number[] = [];

  u8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  /** postcard stores `i8` as one two's-complement byte, not as a varint. */
  i8(value: number): void {
    this.u8(value & 0xff);
  }

  bool(value: boolean): void {
    this.u8(value ? 1 : 0);
  }

  varint(value: number): void {
    let rest = Math.floor(value);
    while (rest >= 0x80) {
      this.bytes.push((rest % 0x80) | 0x80);
      rest = Math.floor(rest / 0x80);
    }
    this.bytes.push(rest);
  }

  zigzag(value: number): void {
    this.varint(value >= 0 ? value * 2 : -value * 2 - 1);
  }

  str(value: string): void {
    const encoded = new TextEncoder().encode(value);
    this.varint(encoded.length);
    for (const byte of encoded) this.bytes.push(byte);
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

export class Reader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  u8(): number {
    if (this.offset >= this.bytes.length) throw new Error('postcard: unexpected end');
    return this.bytes[this.offset++]!;
  }

  /** postcard stores `i8` as one two's-complement byte, not as a varint. */
  i8(): number {
    const value = this.u8();
    return value > 127 ? value - 256 : value;
  }

  bool(): boolean {
    return this.u8() !== 0;
  }

  varint(): number {
    let result = 0;
    let scale = 1;
    for (let index = 0; index < 8; index++) {
      const byte = this.u8();
      result += (byte & 0x7f) * scale;
      if ((byte & 0x80) === 0) return result;
      scale *= 0x80;
    }
    throw new Error('postcard: varint too long');
  }

  zigzag(): number {
    const value = this.varint();
    return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
  }

  str(): string {
    const length = this.varint();
    if (this.offset + length > this.bytes.length) throw new Error('postcard: string overrun');
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return new TextDecoder().decode(slice);
  }

  done(): boolean {
    return this.offset >= this.bytes.length;
  }
}
