import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "public");
const pdfjsDist = join(root, "node_modules", "pdfjs-dist");

if (!existsSync(pdfjsDist)) {
  console.warn("copy-pdfjs-assets: pdfjs-dist not found, skip");
  process.exit(0);
}

mkdirSync(publicDir, { recursive: true });

for (const dir of ["cmaps", "standard_fonts"]) {
  const src = join(pdfjsDist, dir);
  const dest = join(publicDir, dir);
  cpSync(src, dest, { recursive: true });
  console.log(`copied ${dir} -> public/${dir}`);
}
