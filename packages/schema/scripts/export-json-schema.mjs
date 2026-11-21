// Writes schemas/*.schema.json from the Zod schema. Run via `npm run schemas`.
import { writeFileSync } from "node:fs";
import { jsonSchemas } from "../dist/index.js";

const out = new URL("../../../schemas/", import.meta.url);
for (const [name, schema] of Object.entries(jsonSchemas())) {
  const file = new URL(`${name}.schema.json`, out);
  writeFileSync(file, JSON.stringify(schema, null, 2) + "\n");
  console.log(`wrote ${file.pathname}`);
}
