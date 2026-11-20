import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http";

import { readSubmission } from "./http.ts";

it.effect("keeps a JSON file a guest attaches as a file, not a form field", () =>
  Effect.gen(function* () {
    const form = new FormData();
    form.append("shareId", "share-1");
    form.append("text", "");
    form.append("file", new File(['{"a":1}'], "data.json", { type: "application/json" }));
    const request = HttpServerRequest.fromWeb(
      new Request("http://localhost/api/guest/messages?share=share-1", {
        method: "POST",
        body: form,
      }),
    );
    const submission = yield* readSubmission.pipe(
      Effect.provideService(HttpServerRequest.HttpServerRequest, request),
    );
    assert.deepEqual(
      submission?.uploads.map((upload) => [upload.name, upload.contentType]),
      [["data.json", "application/json"]],
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("accepts long guest prompts as multipart form data and JSON", () =>
  Effect.gen(function* () {
    const longPrompt = "x".repeat(100_000);

    const form = new FormData();
    form.append("shareId", "share-1");
    form.append("text", longPrompt);
    const multipartRequest = HttpServerRequest.fromWeb(
      new Request("http://localhost/api/guest/messages?share=share-1", {
        method: "POST",
        body: form,
      }),
    );
    const multipartSubmission = yield* readSubmission.pipe(
      Effect.provideService(HttpServerRequest.HttpServerRequest, multipartRequest),
    );
    assert.equal(multipartSubmission?.fields.text, longPrompt);

    const jsonRequest = HttpServerRequest.fromWeb(
      new Request("http://localhost/api/guest/messages?share=share-1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shareId: "share-1", text: longPrompt }),
      }),
    );
    const jsonSubmission = yield* readSubmission.pipe(
      Effect.provideService(HttpServerRequest.HttpServerRequest, jsonRequest),
    );
    assert.equal(jsonSubmission?.fields.text, longPrompt);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "accepts a long guest prompt alongside attachments up to the file limit and rejects oversized uploads",
  () =>
    Effect.gen(function* () {
      const longPrompt = "x".repeat(100_000);
      const maxAttachmentBytes = new Uint8Array(10 * 1024 * 1024);

      const form = new FormData();
      form.append("shareId", "share-1");
      form.append("text", longPrompt);
      form.append(
        "file",
        new File([maxAttachmentBytes], "exact.bin", { type: "application/octet-stream" }),
      );
      const request = HttpServerRequest.fromWeb(
        new Request("http://localhost/api/guest/messages?share=share-1", {
          method: "POST",
          body: form,
        }),
      );
      const submission = yield* readSubmission.pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, request),
      );
      assert.equal(submission?.fields.text, longPrompt);
      assert.equal(submission?.uploads.length, 1);

      const oversizedForm = new FormData();
      oversizedForm.append("shareId", "share-1");
      oversizedForm.append("text", "hi");
      oversizedForm.append(
        "file",
        new File([new Uint8Array(10 * 1024 * 1024 + 1)], "too-big.bin", {
          type: "application/octet-stream",
        }),
      );
      const oversizedRequest = HttpServerRequest.fromWeb(
        new Request("http://localhost/api/guest/messages?share=share-1", {
          method: "POST",
          body: oversizedForm,
        }),
      );
      const error = yield* Effect.flip(
        readSubmission.pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, oversizedRequest),
        ),
      );
      assert.equal(error.reason, "too_large");

      const multiOversizedForm = new FormData();
      multiOversizedForm.append("shareId", "share-1");
      multiOversizedForm.append("text", "hi");
      multiOversizedForm.append(
        "file",
        new File([new Uint8Array(6 * 1024 * 1024)], "part-1.bin", {
          type: "application/octet-stream",
        }),
      );
      multiOversizedForm.append(
        "file",
        new File([new Uint8Array(6 * 1024 * 1024)], "part-2.bin", {
          type: "application/octet-stream",
        }),
      );
      const multiOversizedRequest = HttpServerRequest.fromWeb(
        new Request("http://localhost/api/guest/messages?share=share-1", {
          method: "POST",
          body: multiOversizedForm,
        }),
      );
      const multiError = yield* Effect.flip(
        readSubmission.pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, multiOversizedRequest),
        ),
      );
      assert.equal(multiError.reason, "too_large");

      const boundary = "----guest-test-boundary";
      const namelessBody = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="shareId"',
        "",
        "share-1",
        `--${boundary}`,
        'Content-Disposition: form-data; name="text"',
        "",
        "hi",
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename=""',
        "Content-Type: application/octet-stream",
        "",
        "0123456789abcdef",
        `--${boundary}--`,
        "",
      ].join("\r\n");
      const namelessFileRequest = HttpServerRequest.fromWeb(
        new Request("http://localhost/api/guest/messages?share=share-1", {
          method: "POST",
          headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
          body: namelessBody,
        }),
      );
      const namelessError = yield* Effect.flip(
        readSubmission.pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, namelessFileRequest),
        ),
      );
      assert.equal(namelessError.reason, "rejected");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
