import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { loadConfig } from "./config.ts";

async function main() {
  const config = loadConfig();
  const app = await Spectrum({
    projectId: config.projectId,
    projectSecret: config.projectSecret,
    providers: [imessage.config()],
  });
  try {
    const im = imessage(app);
    const user = await im.user(config.authorizedSenderId);
    const dm = await im.space.create(user);
    const sent = await dm.send(
      "got you. spectrum is online. text again anytime and i’ll see it live.",
    );
    console.log(sent ? "SENT_OK" : "SENT_UNDEFINED");
  } finally {
    await app.stop();
  }
}

main().catch((err) => {
  console.error("SEND_FAIL", err);
  process.exit(1);
});
