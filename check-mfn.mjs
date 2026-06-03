import { handleHtaDossierPrep } from "./dist/tools/htaDossierPrep.js";
const r = await handleHtaDossierPrep({
  hta_body: "amcp",
  submission_type: "initial",
  drug_name: "TestDrug",
  indication: "Test indication",
  output_format: "text",
});
const c = r.content;
console.log("--- Content type:", typeof c);
console.log("--- Length:", typeof c === "string" ? c.length : "n/a");
console.log(
  "--- Has MFN heading?",
  typeof c === "string" ? c.includes("MFN Exposure") : "n/a",
);
console.log("--- Last 600 chars ---");
console.log(typeof c === "string" ? c.slice(-600) : c);
