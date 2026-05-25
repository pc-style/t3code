/**
 * Strict JSONL framing for Pi RPC mode (`pi --mode rpc`).
 *
 * Pi documents LF-only record delimiters; do not use Node readline, which also
 * splits on Unicode line separators inside JSON strings.
 *
 * @see https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md
 */

export function serializePiRpcLine(value: unknown): string {
  if (value === undefined) {
    throw new Error("Cannot serialize undefined as a Pi RPC JSONL record");
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("JSON.stringify returned undefined for Pi RPC JSONL record");
  }
  return `${serialized}\n`;
}

export function splitPiRpcBuffer(buffer: string): {
  readonly lines: ReadonlyArray<string>;
  readonly rest: string;
} {
  const lines: Array<string> = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== "\n") {
      continue;
    }
    let end = index;
    if (end > start && buffer[end - 1] === "\r") {
      end -= 1;
    }
    const line = buffer.slice(start, end);
    if (line.length > 0) {
      lines.push(line);
    }
    start = index + 1;
  }
  return { lines, rest: buffer.slice(start) };
}

export function parsePiRpcLine(line: string): unknown {
  return JSON.parse(line) as unknown;
}
