import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { loadConfig } from "../src/config.ts";

const config = loadConfig();
const spectrum = await Spectrum({
  projectId: config.projectId,
  projectSecret: config.projectSecret,
  providers: [imessage.config()],
});
try {
  const im = imessage(spectrum);
  const space = await im.space.get("any;-;{{AUTHORIZED_SENDER_ID}}");
  console.log("space.id", space?.id);
  console.log("space own keys", Object.getOwnPropertyNames(Object.getPrototypeOf(space)||{}).slice(0,40));
  // Try settle with unknown to at least document; skip if no message API
} finally {
  await spectrum.stop();
}
