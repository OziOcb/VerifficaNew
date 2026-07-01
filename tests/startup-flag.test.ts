import { describe, expect, it } from "vitest";
import { isStartupGuideEnabled, startupFlagFor } from "@/lib/inspections";

// The settings startup-guide toggle (S-10) is expressed as "guide enabled" (on =
// the FR-009 pop-up shows), but the device-local flag DashboardBoard reads is the
// legacy "don't show again" value where exactly "1" means hidden. These pure
// helpers bridge the two; a drift here would silently break re-enabling the guide.

describe("isStartupGuideEnabled", () => {
  it("is disabled only when the flag is exactly '1'", () => {
    expect(isStartupGuideEnabled("1")).toBe(false);
  });

  it("is enabled for absent, '0', and any other legacy value", () => {
    expect(isStartupGuideEnabled(null)).toBe(true);
    expect(isStartupGuideEnabled(undefined)).toBe(true);
    expect(isStartupGuideEnabled("0")).toBe(true);
    expect(isStartupGuideEnabled("")).toBe(true);
    expect(isStartupGuideEnabled("true")).toBe(true);
  });
});

describe("startupFlagFor", () => {
  it("writes '0' when enabling and '1' when disabling", () => {
    expect(startupFlagFor(true)).toBe("0");
    expect(startupFlagFor(false)).toBe("1");
  });

  it("round-trips through isStartupGuideEnabled", () => {
    expect(isStartupGuideEnabled(startupFlagFor(true))).toBe(true);
    expect(isStartupGuideEnabled(startupFlagFor(false))).toBe(false);
  });
});
