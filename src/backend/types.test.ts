import { describe, expect, it } from "vitest";
import { isBackendError } from "./types";

describe("isBackendError", () => {
  it("recognizes the backend error payload", () => {
    expect(isBackendError({ code: "wrong_password", message: "x" })).toBe(true);
    expect(isBackendError(new Error("x"))).toBe(false);
    expect(isBackendError(null)).toBe(false);
  });
});
