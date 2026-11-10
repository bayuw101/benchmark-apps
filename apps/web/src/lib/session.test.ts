import { describe, expect, it } from "vitest";
import { atLeast } from "./session";

describe("role ladder", () => {
  it("lets higher roles do what lower roles can", () => {
    expect(atLeast("admin", "engineer")).toBe(true);
    expect(atLeast("approver", "engineer")).toBe(true);
    expect(atLeast("engineer", "engineer")).toBe(true);
    expect(atLeast("viewer", "engineer")).toBe(false);
  });
});
