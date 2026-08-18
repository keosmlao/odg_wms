/**
 * ຕົວ run migration ຂອງ WMS — ຮູ້ວ່າ DB ນີ້ run ໄຟລ໌ໃດແລ້ວ ແລະ ຄ້າງອັນໃດ.
 *
 *   node migrations/run.mjs status     ← ເບິ່ງວ່າຄ້າງອັນໃດ (ບໍ່ແຕະ DB)
 *   node migrations/run.mjs up         ← run ທຸກອັນທີ່ຄ້າງ ຕາມລຳດັບເລກ
 *   node migrations/run.mjs baseline [ເລກ]  ← ໝາຍວ່າ "run ແລ້ວ" ໂດຍບໍ່ run ຈິງ
 *          ເຊັ່ນ  baseline 037  = ໝາຍ 001..037, ປະ 038 ຂຶ້ນໄປໄວ້ໃຫ້ up ຈັດການ
 *
 * ເປັນຫຍັງຈຶ່ງມີ: ກ່ອນໜ້ານີ້ບໍ່ມີບ່ອນບັນທຶກວ່າ DB ໃດ run migration ໃດ — 034/035
 * ຈຶ່ງຫາຍໄປໂດຍບໍ່ມີໃຜຮູ້ ຈົນໜ້າຈໍລົ້ມດ້ວຍ "relation does not exist". ຕາຕະລາງ
 * `odg_wms_schema_migration` ຄືບັນທຶກນັ້ນ (ຕາຕະລາງ `migrations` ແລະ
 * `_prisma_migrations` ໃນ DB ດຽວກັນເປັນຂອງແອັບອື່ນ ບໍ່ກ່ຽວກັບ WMS).
 *
 * ແຕ່ລະໄຟລ໌ run ໃນ transaction ຂອງມັນເອງ — ລົ້ມກາງທາງ = ໄຟລ໌ນັ້ນ rollback
 * ທັງໜ່ວຍ ແລະ ຢຸດທັນທີ (ບໍ່ຂ້າມໄປໄຟລ໌ຖັດໄປ).
 *
 * `baseline` ໃຊ້ເທື່ອດຽວຕອນເລີ່ມໃຊ້ ledger ນີ້ ກັບ DB ທີ່ run ໄຟລ໌ເກົ່າໄປແລ້ວ.
 */
import pg from "pg";
import { createHash } from "crypto";
import { readdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const text = readFileSync(join(HERE, "..", ".env.local"), "utf8");
  return Object.fromEntries(
    text
      .split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      }),
  );
}

/** ໄຟລ໌ .sql ທັງໝົດ ຮຽງຕາມຊື່ (ເລກນຳໜ້າ = ລຳດັບ). */
function localMigrations() {
  return readdirSync(HERE)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((filename) => {
      const sql = readFileSync(join(HERE, filename), "utf8");
      return { filename, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    });
}

async function ensureLedger(c) {
  await c.query(`
    CREATE TABLE IF NOT EXISTS public.odg_wms_schema_migration (
      filename   varchar(120) PRIMARY KEY,
      checksum   char(64)     NOT NULL,
      applied_at timestamptz  NOT NULL DEFAULT now(),
      applied_by varchar(60)
    )`);
  await c.query(`
    COMMENT ON TABLE public.odg_wms_schema_migration
      IS 'migration ຂອງ WMS ທີ່ DB ນີ້ run ແລ້ວ — ຈັດການໂດຍ migrations/run.mjs'`);
}

/** ລວມສະຖານະຂອງແຕ່ລະໄຟລ໌: pending | applied | changed (ແກ້ຫຼັງ run ໄປແລ້ວ). */
async function collect(c) {
  const applied = new Map(
    (await c.query(`SELECT filename, checksum, applied_at FROM public.odg_wms_schema_migration`)).rows.map((r) => [
      r.filename,
      r,
    ]),
  );
  const files = localMigrations();
  const rows = files.map((f) => {
    const a = applied.get(f.filename);
    return { ...f, state: !a ? "pending" : a.checksum === f.checksum ? "applied" : "changed", appliedAt: a?.applied_at };
  });
  const orphans = [...applied.keys()].filter((k) => !files.some((f) => f.filename === k));
  return { rows, orphans };
}

const label = { applied: "  ok     ", pending: "  PENDING", changed: "  CHANGED" };

async function main() {
  const cmd = process.argv[2] ?? "status";
  if (!["status", "up", "baseline"].includes(cmd)) {
    console.error(`ຄຳສັ່ງບໍ່ຮູ້ຈັກ: ${cmd}\nໃຊ້: status | up | baseline`);
    process.exitCode = 1;
    return;
  }

  const env = loadEnv();
  const c = new pg.Client({
    host: env.DATABASE_HOST || env.PGHOST,
    port: +(env.DATABASE_PORT || 5432),
    user: env.DATABASE_USER || env.PGUSER,
    password: env.DATABASE_PASSWORD || env.PGPASSWORD,
    database: env.DATABASE_NAME || "odg",
    ssl: /^(1|true|require)$/i.test(env.DATABASE_SSL || "") ? { rejectUnauthorized: false } : undefined,
  });
  await c.connect();

  try {
    await ensureLedger(c);
    const { rows, orphans } = await collect(c);
    const pending = rows.filter((r) => r.state === "pending");
    const changed = rows.filter((r) => r.state === "changed");

    if (cmd === "status") {
      for (const r of rows) console.log(`${label[r.state]}  ${r.filename}`);
      for (const o of orphans) console.log(`  ORPHAN   ${o} (ຢູ່ໃນ DB ແຕ່ບໍ່ມີໄຟລ໌ແລ້ວ)`);
      console.log(`\n${rows.length} ໄຟລ໌ · run ແລ້ວ ${rows.length - pending.length - changed.length} · ຄ້າງ ${pending.length}${changed.length ? ` · ຖືກແກ້ຫຼັງ run ${changed.length}` : ""}`);
      if (pending.length > 0) console.log(`\nrun ດ້ວຍ:  node migrations/run.mjs up`);
      return;
    }

    if (cmd === "baseline") {
      // ອາກິວເມັນທີ 2 = ໄຟລ໌ສຸດທ້າຍທີ່ຈະໝາຍ (ເຊັ່ນ "037") — ບໍ່ໃສ່ = ໝາຍທຸກອັນທີ່ຄ້າງ.
      const through = process.argv[3]?.trim();
      let target = pending;
      if (through) {
        const match = rows.filter((r) => r.filename.startsWith(through)).pop();
        if (!match) {
          console.error(`ບໍ່ພົບໄຟລ໌ທີ່ຂຶ້ນຕົ້ນດ້ວຍ "${through}"`);
          process.exitCode = 1;
          return;
        }
        target = pending.filter((r) => r.filename <= match.filename);
      }
      if (target.length === 0) {
        console.log("ບໍ່ມີໄຟລ໌ຄ້າງ — ບໍ່ຕ້ອງ baseline");
        return;
      }
      for (const r of target) {
        await c.query(
          `INSERT INTO public.odg_wms_schema_migration (filename, checksum, applied_by)
           VALUES ($1, $2, 'baseline') ON CONFLICT (filename) DO NOTHING`,
          [r.filename, r.checksum],
        );
        console.log(`  baseline  ${r.filename}`);
      }
      console.log(`\n⚠️  ໝາຍວ່າ run ແລ້ວ ${target.length} ໄຟລ໌ ໂດຍ**ບໍ່ໄດ້ run ຈິງ** — ໃຊ້ກັບ DB ທີ່ມີໂຄງສ້າງຢູ່ແລ້ວເທົ່ານັ້ນ`);
      return;
    }

    // cmd === "up"
    if (changed.length > 0) {
      console.log(`⚠️  ${changed.length} ໄຟລ໌ຖືກແກ້ຫຼັງ run ໄປແລ້ວ (ຈະບໍ່ run ຊ້ຳ): ${changed.map((r) => r.filename).join(", ")}\n`);
    }
    if (pending.length === 0) {
      console.log("ບໍ່ມີ migration ຄ້າງ — DB ທັນສະໄໝແລ້ວ");
      return;
    }
    const who = (env.USERNAME || env.USER || "run.mjs").slice(0, 60);
    for (const r of pending) {
      process.stdout.write(`  run  ${r.filename} ... `);
      try {
        await c.query("BEGIN");
        await c.query(r.sql);
        await c.query(
          `INSERT INTO public.odg_wms_schema_migration (filename, checksum, applied_by) VALUES ($1, $2, $3)`,
          [r.filename, r.checksum, who],
        );
        await c.query("COMMIT");
        console.log("ok");
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        console.log("ລົ້ມເຫຼວ");
        console.error(`\n❌ ${r.filename}: ${e.message}\n   (rollback ແລ້ວ — ໄຟລ໌ຖັດໄປບໍ່ຖືກ run)`);
        process.exitCode = 1;
        return;
      }
    }
    console.log(`\n✅ run ສຳເລັດ ${pending.length} ໄຟລ໌`);
  } finally {
    await c.end();
  }
}

await main();
