import { describe, expect, it } from "vitest";
import { createAutomationTools } from "../server/automation-tools.js";
import { INTERACTION_SYSTEM } from "../server/interaction-agent.js";
import { CODEX_USER_FACING_VOICE_OVERLAY } from "../server/runtimes/codex-app-server.js";

describe("Azraj user-facing identity", () => {
  it("uses Azraj, not Boop, in runtime-facing identity prompts", () => {
    expect(INTERACTION_SYSTEM).toContain("You are Azraj");
    expect(INTERACTION_SYSTEM).toContain("AI accountability coach");
    expect(INTERACTION_SYSTEM).not.toContain("You are Boop");

    expect(CODEX_USER_FACING_VOICE_OVERLAY).toContain("powering Azraj");
    expect(CODEX_USER_FACING_VOICE_OVERLAY).toContain("say you are Azraj");
    expect(CODEX_USER_FACING_VOICE_OVERLAY).not.toContain("say you are Boop");
  });
});

describe("Azraj accountability coaching prompt", () => {
  it("covers daily planning, progress check-ins, night review, and weekly research", () => {
    expect(INTERACTION_SYSTEM).toContain("Morning planning");
    expect(INTERACTION_SYSTEM).toContain("journal-style check-in");
    expect(INTERACTION_SYSTEM).toContain("concrete daily objectives");
    expect(INTERACTION_SYSTEM).toContain("Progress check-ins");
    expect(INTERACTION_SYSTEM).toContain("Night review");
    expect(INTERACTION_SYSTEM).toContain("mindset of the week");
    expect(INTERACTION_SYSTEM).toContain("person of the week");
    expect(INTERACTION_SYSTEM).toContain("suggested readings with sources");
  });

  it("uses existing memory and automation tools for coaching state and check-ins", () => {
    expect(INTERACTION_SYSTEM).toContain("Use create_automation");
    expect(INTERACTION_SYSTEM).toContain("Use write_memory");
    expect(INTERACTION_SYSTEM).toContain("durable goals");
    expect(INTERACTION_SYSTEM).toContain("recurring morning, progress, night, or weekly check-ins");
  });
});

describe("automation scheduling contract", () => {
  it("remains timezone-aware and user-local", () => {
    const createAutomation = createAutomationTools("conversation:test").find(
      (tool) => tool.name === "create_automation",
    );

    expect(createAutomation?.description).toContain("5 fields");
    expect(createAutomation?.description).toContain("user's LOCAL clock");
    expect(createAutomation?.description).toContain("do NOT convert to UTC");
    expect(createAutomation?.description).toContain("settings.user_timezone");
  });
});
