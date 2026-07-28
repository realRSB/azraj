import { describe, expect, it } from "vitest";
import {
  VOICE_CORPUS,
  classifySituation,
  sampleVoiceCorpus,
} from "../server/voice-corpus.js";
import { __internal } from "../server/voice-profile.js";
import { cleanReplyText, normalizeDashes } from "../server/text-style.js";

const { analyze, describe: describeStyle } = __internal;

describe("classifySituation", () => {
  it("routes the common openers", () => {
    expect(classifySituation("yooo")).toBe("greeting");
    expect(classifySituation("wsg")).toBe("greeting");
    expect(classifySituation("good morning")).toBe("greeting");
  });

  it("separates a win from a miss", () => {
    expect(classifySituation("just finished all 3 modules")).toBe("win");
    expect(classifySituation("got a 680")).toBe("win");
    expect(classifySituation("didnt do it")).toBe("miss");
    expect(classifySituation("i forgot")).toBe("miss");
  });

  it("puts an emotional message in venting, not planning", () => {
    expect(classifySituation("im so tired man")).toBe("venting");
    expect(classifySituation("i feel like im so behind everyone")).toBe("venting");
    expect(classifySituation("idk why i even try")).toBe("venting");
  });

  it("catches stalling", () => {
    expect(classifySituation("in 5 mins")).toBe("procrastinating");
    expect(classifySituation("i cant focus")).toBe("procrastinating");
  });

  it("catches scheduling asks", () => {
    expect(classifySituation("check in on me at 8")).toBe("logistics");
    expect(classifySituation("stop reminding me")).toBe("logistics");
  });

  it("treats an empty message as a proactive check-in", () => {
    expect(classifySituation("")).toBe("checkin");
    expect(classifySituation("   ")).toBe("checkin");
  });
});

describe("sampleVoiceCorpus", () => {
  it("leads with examples from the detected situation", () => {
    const block = sampleVoiceCorpus({ userText: "i didnt do it", seed: "abc" });
    expect(block).toContain('this looks like a "miss" moment');
    expect(block).toContain("what got in the way");
  });

  it("is deterministic for the same seed and varies across seeds", () => {
    const a = sampleVoiceCorpus({ userText: "hey", seed: "turn-1" });
    const b = sampleVoiceCorpus({ userText: "hey", seed: "turn-1" });
    const c = sampleVoiceCorpus({ userText: "hey", seed: "turn-99" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("stays small enough to inject every turn", () => {
    const block = sampleVoiceCorpus({ userText: "i finished the essay", seed: "x" });
    expect(block.length).toBeLessThan(2500);
  });
});

describe("voice corpus content", () => {
  it("never uses the banned bot-coded emoji", () => {
    const banned = ["💪", "🙌", "👍", "🙂", "😊", "😄", "✨", "🎯", "🚀"];
    for (const example of VOICE_CORPUS) {
      for (const emoji of banned) {
        expect(example.azraj, `"${example.azraj}"`).not.toContain(emoji);
      }
    }
  });

  it("never uses markdown or em-dashes, which break in iMessage", () => {
    for (const example of VOICE_CORPUS) {
      expect(example.azraj).not.toContain("**");
      expect(example.azraj).not.toContain("—");
    }
  });

  it("keeps venting replies free of slang and emoji", () => {
    const venting = VOICE_CORPUS.filter((e) => e.situation === "venting");
    expect(venting.length).toBeGreaterThan(3);
    for (const example of venting) {
      expect(example.azraj, `"${example.azraj}"`).not.toMatch(
        /\b(fr|bet|ngl|lowkey|W|no shot|deadass)\b/,
      );
      expect(example.azraj).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe("normalizeDashes", () => {
  it("turns a spaced em-dash into a comma", () => {
    expect(normalizeDashes("what's tripping you up — timing or the content?")).toBe(
      "what's tripping you up, timing or the content?",
    );
  });

  it("turns an unspaced dash into a plain hyphen", () => {
    expect(normalizeDashes("the 8—9pm block")).toBe("the 8-9pm block");
  });

  it("handles en-dashes too", () => {
    expect(normalizeDashes("nice work – keep going")).toBe("nice work, keep going");
  });

  it("leaves ordinary hyphens and text alone", () => {
    const clean = "check-in at 8pm, well-earned W";
    expect(cleanReplyText(clean)).toBe(clean);
  });

  it("is what the dispatcher applies to replies", () => {
    expect(cleanReplyText("680 is solid — what'd math come out to?")).toBe(
      "680 is solid, what'd math come out to?",
    );
  });
});

describe("voice profile analysis", () => {
  it("detects a lowercase fragment texter", () => {
    const signals = analyze(["yooo", "did the essay", "nah not yet", "bet"]);
    expect(signals.lowercaseRatio).toBe(1);
    expect(signals.avgWords).toBeLessThan(5);
    expect(signals.bursts).toBe(true);

    const notes = describeStyle(signals).join(" ");
    expect(notes).toContain("short fragments");
    expect(notes).toContain("lowercase");
  });

  it("detects a formal texter and pulls the register back", () => {
    const signals = analyze([
      "Good morning. I finished the second module last night.",
      "I scored a 680 on the reading section, which I am happy with.",
      "Could you please remind me at 8pm tonight?",
      "Thank you, that works well for my schedule.",
    ]);
    expect(signals.lowercaseRatio).toBeLessThan(0.2);
    expect(signals.terminalPunctuationRatio).toBeGreaterThan(0.6);

    const notes = describeStyle(signals).join(" ");
    expect(notes).toContain("capitalize and punctuate");
  });

  it("picks up the emoji and slang they actually use", () => {
    const signals = analyze([
      "ngl that was rough 😭",
      "fr though 😭",
      "im cooked 💀",
      "bet 😭",
    ]);
    expect(signals.topEmoji[0]).toBe("😭");
    expect(signals.slangUsed).toContain("ngl");
    expect(signals.slangUsed).toContain("fr");
    expect(signals.emojiPerMessage).toBeGreaterThan(0.9);

    const notes = describeStyle(signals).join(" ");
    expect(notes).toContain("😭");
    expect(notes).toContain("ngl");
  });

  it("tells Azraj to hold back when the user never uses emoji", () => {
    const signals = analyze([
      "did module 2",
      "not yet",
      "probably around 8",
      "yeah that works",
    ]);
    expect(signals.emojiPerMessage).toBe(0);
    const notes = describeStyle(signals).join(" ");
    expect(notes).toContain("never use emoji");
  });

  it("notices stretched words", () => {
    const signals = analyze(["yooooo", "sooo tired", "ahhhh", "ok"]);
    expect(signals.elongates).toBe(true);
  });
});
