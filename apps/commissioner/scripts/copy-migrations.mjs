import { cp, mkdir, rm } from "node:fs/promises";

await rm(new URL("../dist/ui/", import.meta.url), { recursive: true, force: true });

await mkdir(new URL("../dist/prisma/migrations/", import.meta.url), { recursive: true });
await cp(
  new URL("../prisma/migrations/", import.meta.url),
  new URL("../dist/prisma/migrations/", import.meta.url),
  { recursive: true },
);
await mkdir(new URL("../dist/src/ui/demo/", import.meta.url), { recursive: true });
await cp(new URL("../src/ui/demo/index.html", import.meta.url), new URL("../dist/src/ui/demo/index.html", import.meta.url));
