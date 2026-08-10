import { describe, expect, it } from "vitest";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";
import { CommandCodeExecutor } from "../../open-sse/executors/commandcode.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";

describe("clinepass max thinking", () => {
  const models = [
    "cline-pass/glm-5.2",
    "cline-pass/kimi-k2.7-code",
    "cline-pass/deepseek-v4-pro",
    "cline-pass/minimax-m3",
    "cline-pass/qwen3.7-max",
  ];

  it("transport forces openai thinkingFormat", () => {
    expect(PROVIDERS.clinepass.thinkingFormat).toBe("openai");
  });

  it.each(models)("%s levels include max + openai wire", (model) => {
    const levels = getThinkingLevels("clinepass", model);
    expect(levels).toContain("max");
    expect(getCapabilitiesForModel("clinepass", model).thinkingFormat).toBe("openai");

    const body = { reasoning_effort: "max" };
    applyThinking(FORMATS.OPENAI, model, body, "clinepass");
    expect(body.reasoning_effort).toBe("max");
  });
});

describe("commandcode all models max thinking", () => {
  const models = [
    "deepseek/deepseek-v4-pro",
    "moonshotai/Kimi-K2.6",
    "zai-org/GLM-5.1",
    "MiniMaxAI/MiniMax-M2.7",
    "Qwen/Qwen3.6-Plus",
    "gpt-5.6-luna",
  ];

  it("transport forces openai thinkingFormat", () => {
    expect(PROVIDERS.commandcode.thinkingFormat).toBe("openai");
  });

  it.each(models)("%s levels include max and land in params", (model) => {
    const levels = getThinkingLevels("commandcode", model);
    expect(levels).toContain("max");

    const body = { reasoning_effort: "max" };
    applyThinking(FORMATS.COMMANDCODE, model, body, "commandcode");
    expect(body.reasoning_effort).toBe("max");

    const out = new CommandCodeExecutor().transformRequest(
      model,
      { params: { model, messages: [] }, reasoning_effort: "max" },
      true,
      {},
    );
    expect(out.params.reasoning_effort).toBe("max");
    expect(out.reasoning_effort).toBeUndefined();
  });
});

describe("codebuddy-cn max → high wire", () => {
  it("UI levels include max", () => {
    expect(getThinkingLevels("codebuddy-cn", "glm-5.2")).toContain("max");
  });

  it("executor maps max/xhigh → high", () => {
    const ex = new CodeBuddyExecutor();
    for (const effort of ["max", "xhigh"]) {
      const out = ex.transformRequest(
        "glm-5.2",
        { messages: [{ role: "user", content: "hi" }], reasoning_effort: effort },
        false,
        {},
      );
      expect(out.reasoning_effort).toBe("high");
      expect(out.reasoning_summary).toBe("auto");
    }
  });

  it("keeps high as high", () => {
    const out = new CodeBuddyExecutor().transformRequest(
      "glm-5.2",
      { messages: [{ role: "user", content: "hi" }], reasoning_effort: "high" },
      false,
      {},
    );
    expect(out.reasoning_effort).toBe("high");
  });
});
