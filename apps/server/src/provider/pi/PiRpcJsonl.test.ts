import { describe, expect, it } from "vitest";

import { parsePiRpcLine, serializePiRpcLine, splitPiRpcBuffer } from "./PiRpcJsonl.ts";

describe("PiRpcJsonl", () => {
  it("serializes commands with a trailing newline", () => {
    expect(serializePiRpcLine({ type: "prompt", message: "hi" })).toBe(
      '{"type":"prompt","message":"hi"}\n',
    );
  });

  it("splits on LF only and preserves JSON with unicode separators", () => {
    const payload = { text: "\u2028line\u2029break" };
    const buffer = `${serializePiRpcLine(payload)}${serializePiRpcLine({ type: "abort" })}`;
    const split = splitPiRpcBuffer(buffer);
    expect(split.lines).toHaveLength(2);
    expect(parsePiRpcLine(split.lines[0]!)).toEqual(payload);
    expect(split.rest).toBe("");
  });

  it("accepts CRLF delimiters", () => {
    const split = splitPiRpcBuffer('{"type":"abort"}\r\n');
    expect(split.lines).toEqual(['{"type":"abort"}']);
  });

  it("rejects undefined payloads", () => {
    expect(() => serializePiRpcLine(undefined)).toThrow(
      "Cannot serialize undefined as a Pi RPC JSONL record",
    );
  });
});
