import { describe, expect, it } from "vitest";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { CommandCodeExecutor } from "../../open-sse/executors/commandcode.js";

// Regression: custom model gpt-5.6-luna on CommandCode used to clamp max→xhigh
// because PATTERN_THINKING only allowed max for provider=codex. CommandCode hosts
// the same model id as a custom model; levels must include max and the effort
// must land in params.reasoning_effort (CommandCode envelope).
describe("commandcode + gpt-5.6-luna thinking max", () => {
  it("getThinkingLevels includes max (not capped at xhigh)", () => {
    const levels = getThinkingLevels("commandcode", "gpt-5.6-luna");
    expect(levels).toContain("max");
    expect(levels).toContain("xhigh");
  });

  it("applyThinking keeps reasoning_effort max (does not clamp to xhigh)", () => {
    const body = { reasoning_effort: "max" };
    applyThinking(FORMATS.COMMANDCODE, "gpt-5.6-luna", body, "commandcode");
    expect(body.reasoning_effort).toBe("max");
  });

  it("executor moves top-level reasoning_effort into params", () => {
    const ex = new CommandCodeExecutor();
    const body = {
      params: { model: "gpt-5.6-luna", messages: [] },
      reasoning_effort: "max",
    };
    const out = ex.transformRequest("gpt-5.6-luna", body, true, {});
    expect(out.params.reasoning_effort).toBe("max");
    expect(out.reasoning_effort).toBeUndefined();
  });
});
