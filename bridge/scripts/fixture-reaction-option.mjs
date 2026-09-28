#!/usr/bin/env bun
// This helper has no production destination and never creates a Spectrum client.
if (process.env.PHOTON_TEST_MODE !== "1" || !process.env.PHOTON_INSTANCE_DIR) throw new Error("ISOLATED_TEST_INSTANCE_REQUIRED");
const { buildAttachmentGroupParts, formatChildId } = await import("../src/reaction-option.ts");
const parts = buildAttachmentGroupParts({ parentMessageId:"synthetic-parent", paths:["synthetic-a", "synthetic-b"], cards:[{title:"Option A"},{title:"Option B",price:"$12",url:"https://example.test/b"}] });
if (parts[1].childId !== formatChildId(1,"synthetic-parent")) throw new Error("FIXTURE_FAILED");
console.log(JSON.stringify({fixture:true,parts:parts.length}));
