import { cp, mkdir } from "node:fs/promises";

await mkdir(new URL("../dist/prisma/migrations/", import.meta.url), { recursive: true });
await cp(
  new URL("../prisma/migrations/", import.meta.url),
  new URL("../dist/prisma/migrations/", import.meta.url),
  { recursive: true },
);
