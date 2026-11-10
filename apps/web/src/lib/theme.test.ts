import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, parseTheme } from "./theme";

describe("parseTheme", () => {
  it("defaults to light when nothing is stored", () => {
    expect(DEFAULT_THEME).toBe("light");
    expect(parseTheme(null)).toBe("light");
    expect(parseTheme(undefined)).toBe("light");
  });
  it("keeps a stored dark choice", () => {
    expect(parseTheme("dark")).toBe("dark");
  });
  it("treats any other stored value as light", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("DARK")).toBe("light");
    expect(parseTheme("system")).toBe("light");
    expect(parseTheme("")).toBe("light");
  });
});
