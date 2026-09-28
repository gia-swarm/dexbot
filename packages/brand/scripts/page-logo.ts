/** Rewrites src/page-logo.ts from src/icon.png. */
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const icon = await Bun.file(join(root, "src/icon.png")).bytes();
const target = join(root, "src/page-logo.ts");
const source = await Bun.file(target).text();
await Bun.write(
  target,
  source.replace(
    /data:image\/png;base64,[A-Za-z0-9+/=]+/,
    `data:image/png;base64,${Buffer.from(icon).toString("base64")}`,
  ),
);
