import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { errorCode, errorMessage, errorName, isTimeoutError } from "../src/lib/errorMessage";

describe("errorMessage", () => {
  it("reads the message of an Error", () => {
    assert.equal(errorMessage(new Error("boom")), "boom");
  });

  it("reads the message of a plain object that carries one", () => {
    assert.equal(errorMessage({ message: "boom" }), "boom");
  });

  it("returns undefined when there is no message", () => {
    assert.equal(errorMessage("boom"), undefined);
    assert.equal(errorMessage(null), undefined);
    assert.equal(errorMessage({ code: 1 }), undefined);
  });
});

describe("errorCode", () => {
  it("reads the code of a Discord or Node error", () => {
    assert.equal(errorCode({ code: 10003 }), 10003);
    assert.equal(errorCode({ code: "ECONNRESET" }), "ECONNRESET");
  });

  it("returns undefined when there is no code", () => {
    assert.equal(errorCode(new Error("boom")), undefined);
    assert.equal(errorCode(undefined), undefined);
  });
});

describe("errorName", () => {
  it("reads the name of an error", () => {
    assert.equal(errorName(new TypeError("boom")), "TypeError");
    assert.equal(errorName({ name: "AbortError" }), "AbortError");
  });
});

describe("isTimeoutError", () => {
  it("recognises the abort our own fetch timeout produces", () => {
    // node-fetch rejects with an AbortError when the AbortController fires.
    const aborted = new Error("The operation was aborted.");
    aborted.name = "AbortError";
    assert.equal(isTimeoutError(aborted), true);
  });

  it("does not treat other failures as a timeout", () => {
    assert.equal(isTimeoutError(new Error("boom")), false);
    assert.equal(isTimeoutError({ code: 10003 }), false);
    assert.equal(isTimeoutError(undefined), false);
  });
});
