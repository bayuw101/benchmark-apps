import { describe, expect, it } from "vitest";
import { projectInitials, projectSlug, resolveProjectId } from "./projects";

const projects = [
  { id: "arbiter-ticketing", name: "Ticketing" },
  { id: "widgets", name: "Widgets" },
];

describe("resolveProjectId", () => {
  it("keeps a known project", () => {
    expect(resolveProjectId("widgets", projects)).toBe("widgets");
  });
  it("falls back to the first project for missing or tampered cookie values", () => {
    expect(resolveProjectId(undefined, projects)).toBe("arbiter-ticketing");
    expect(resolveProjectId("../../admin", projects)).toBe("arbiter-ticketing");
    expect(resolveProjectId("WIDGETS", projects)).toBe("arbiter-ticketing"); // ids are case-sensitive
    expect(resolveProjectId("widgets", [])).toBe("");
  });
});

describe("projectSlug", () => {
  it("makes a unique id", () => {
    expect(projectSlug("Fan ticketing app!", [])).toBe("fan-ticketing-app");
    expect(projectSlug("Widgets", ["widgets", "widgets-2"])).toBe("widgets-3");
    expect(projectSlug("***", [])).toBe("project");
  });
});

describe("projectInitials", () => {
  it("uses up to two words", () => {
    expect(projectInitials("Fan ticketing")).toBe("FT");
    expect(projectInitials("Ticketing")).toBe("T");
    expect(projectInitials("  one two three ")).toBe("OT");
  });
});
