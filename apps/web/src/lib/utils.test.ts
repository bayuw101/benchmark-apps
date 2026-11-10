import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("treats the design-system text sizes as sizes, not colours", () => {
    // Regression: text-label was once merged as a colour and dropped text-muted-foreground.
    expect(cn("text-sm text-muted-foreground", "text-label")).toBe("text-muted-foreground text-label");
    expect(cn("text-label", "text-micro")).toBe("text-micro");
  });
  it("keeps the focus shadow distinct from elevation shadows", () => {
    expect(cn("shadow-sm", "shadow-focus")).toBe("shadow-focus");
  });
});
