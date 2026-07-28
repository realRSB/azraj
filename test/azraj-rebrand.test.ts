import { describe, expect, it } from "vitest";
import { createAutomationTools } from "../server/automation-tools.js";
import {
  createDraftStagingTools,
  isCurrentConversationDraft,
} from "../server/draft-tools.js";
import { EXECUTION_SYSTEM } from "../server/execution-agent.js";
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
  it("covers daily planning, progress check-ins, night review, and weekly ritual", () => {
    expect(INTERACTION_SYSTEM).toContain("Morning planning");
    expect(INTERACTION_SYSTEM).toContain("journal-style check-in");
    expect(INTERACTION_SYSTEM).toContain("concrete daily objectives");
    expect(INTERACTION_SYSTEM).toContain("Progress check-ins");
    expect(INTERACTION_SYSTEM).toContain("Night review");
    expect(INTERACTION_SYSTEM.toLowerCase()).toContain("mindset");
    expect(INTERACTION_SYSTEM).toContain("person of the week");
    expect(INTERACTION_SYSTEM).toContain("article to read");
    expect(INTERACTION_SYSTEM).toContain("set_weekly_schedule");
  });

  it("uses existing memory and automation tools for coaching state and check-ins", () => {
    expect(INTERACTION_SYSTEM).toContain("Use create_automation");
    expect(INTERACTION_SYSTEM).toContain("Use write_memory");
    expect(INTERACTION_SYSTEM).toContain("durable goals");
    expect(INTERACTION_SYSTEM).toContain("recurring morning, progress, night, or weekly check-ins");
  });

  it("uses a casual, motivating gen-z voice", () => {
    expect(INTERACTION_SYSTEM).toContain("texting a friend under 25");
    expect(INTERACTION_SYSTEM).toContain("lowercase by default");
    expect(INTERACTION_SYSTEM).toContain("Slang is seasoning, not the meal");
    expect(INTERACTION_SYSTEM).toContain("Shorten things");
    expect(INTERACTION_SYSTEM).toContain("Celebrate real progress briefly");
    expect(CODEX_USER_FACING_VOICE_OVERLAY).toContain("lowercase by default");
    expect(CODEX_USER_FACING_VOICE_OVERLAY).toContain("texting shorthand");
  });

  // Both voice surfaces have to agree. The dispatcher prompt and the Codex
  // overlay are edited in different files months apart, and the failure mode is
  // silent: Azraj sounds like a friend on Claude and like a coach app on Codex.
  it("keeps the same mechanical rules on both runtimes", () => {
    for (const prompt of [INTERACTION_SYSTEM, CODEX_USER_FACING_VOICE_OVERLAY]) {
      expect(prompt).toContain("markdown");
      expect(prompt).toContain("em-dash");
      expect(prompt).toMatch(/💀|😭/);

      // 💪 is the single most bot-coded emoji, so both prompts must ban it
      // rather than merely mention it.
      const muscleLine = prompt.split("\n").find((l) => l.includes("💪"));
      expect(muscleLine).toBeDefined();
      expect(muscleLine!.toLowerCase()).toMatch(/never|no /);
    }
  });

  it("adapts per user and drops the act when things get heavy", () => {
    expect(INTERACTION_SYSTEM).toContain("{{VOICE_PROFILE}}");
    expect(INTERACTION_SYSTEM).toContain("{{VOICE_EXAMPLES}}");
    expect(INTERACTION_SYSTEM).toContain("Read the room");
    expect(CODEX_USER_FACING_VOICE_OVERLAY).toContain("venting");
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

  it("keeps scheduled accountability check-ins out of the draft flow", async () => {
    expect(INTERACTION_SYSTEM).toContain("Scheduled accountability check-ins are automations, not drafts");
    expect(EXECUTION_SYSTEM).toContain("AUTOMATION tasks and accountability check-ins");
    expect(EXECUTION_SYSTEM).toContain("Do not call save_draft");

    expect(isCurrentConversationDraft("imessage.accountability_check")).toBe(true);
    expect(isCurrentConversationDraft("sms.check-in")).toBe(true);
    expect(isCurrentConversationDraft("slack.message")).toBe(false);
    expect(isCurrentConversationDraft("gmail.reply")).toBe(false);

    const saveDraft = createDraftStagingTools("sms:test").find(
      (tool) => tool.name === "save_draft",
    );
    const result = await saveDraft?.handle({
      kind: "imessage.accountability_check",
      summary: "11:30am accountability check",
      payload: "{}",
    });

    expect(result?.success).toBe(false);
    expect(result?.text).toContain("Do not save this as a draft");
  });
});
