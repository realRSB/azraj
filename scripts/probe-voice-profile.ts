// Dev helper: print the learned voice profile for one or more conversation ids.
//   npx tsx scripts/probe-voice-profile.ts chat:gz4 chat:gz1
import { config } from "dotenv";
config({ path: ".env.local" });
config();

const { buildVoiceProfile } = await import("../server/voice-profile.js");

const ids = process.argv.slice(2);
if (!ids.length) {
  console.error("usage: npx tsx scripts/probe-voice-profile.ts <conversationId...>");
  process.exit(1);
}

for (const id of ids) {
  console.log(`--- ${id} ---`);
  console.log(await buildVoiceProfile(id));
  console.log();
}
