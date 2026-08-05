"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export type LineEntry = {
  line_id: number;
  label_code: string;
  qty: string;
  counted_unit: string | null;
  counted_at: string;
};

export type MismatchGroup = {
  item_code: string;
  item_name: string | null;
  sml_unit: string | null;
  lines: LineEntry[];
};

export type HistoryEntry = {
  log_id: number;
  line_id: number;
  item_code: string;
  old_unit_code: string | null;
  new_unit_code: string | null;
  changed_at: string;
  changed_by_name: string | null;
  note: string | null;
};

type Props = {
  sessionId: number;
  canEdit: boolean;
  groups: MismatchGroup[];
  historyByLine: Record<number, HistoryEntry[]>;
  historyByItem: Record<string, HistoryEntry[]>;
};

export default function UnitMismatchTable({
  sessionId,
  canEdit,
  groups,
  historyByLine,
  historyByItem,
}: Props) {
  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-6 py-10 text-center text-sm font-medium text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-200">
        ✓ ບໍ່ມີຫົວໜ່ວຍບໍ່ກົງ — ການກວດນັບໃຊ້ຫົວໜ່ວຍຄືກັນກັບ SML ໝົດ
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <GroupCard
          key={g.item_code}
          sessionId={sessionId}
          canEdit={canEdit}
          group={g}
          historyByLine={historyByLine}
          itemHistory={historyByItem[g.item_code] ?? []}
        />
      ))}
    </div>
  );
}

function GroupCard({
  sessionId,
  canEdit,
  group,
  historyByLine,
  itemHistory,
}: {
  sessionId: number;
  canEdit: boolean;
  group: MismatchGroup;
  historyByLine: Record<number, HistoryEntry[]>;
  itemHistory: HistoryEntry[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [updatedCount, setUpdatedCount] = useState<number | null>(null);
  const compareUrl = `/stocktake/${sessionId}/report?scope=counted&filter=variance`;

  function applySmlUnitToGroup() {
    if (!group.sml_unit) return;
    setError(null);
    setUpdatedCount(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/stocktake/sessions/${sessionId}/units`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            item_code: group.item_code,
            line_ids: group.lines.map((line) => line.line_id),
            new_unit_code: group.sml_unit,
            note: "ປັບຫົວໜ່ວຍຕາມ SML ຈາກໜ້າກວດສອບ",
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          updated_count?: number;
        };
        if (!res.ok || !data.ok) {
          setError(data.error ?? "ບໍ່ສຳເລັດ");
          return;
        }
        setUpdatedCount(data.updated_count ?? 0);
        router.prefetch(compareUrl);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
      }
    });
  }

  return (
    <details
      className="overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm dark:border-amber-900/60 dark:bg-zinc-900"
      open={group.lines.length <= 5}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-sm font-bold text-zinc-900 dark:text-zinc-50">
              {group.item_code}
            </span>
            {group.item_name && (
              <span className="truncate text-xs text-zinc-500">
                {group.item_name}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-zinc-500">
            {group.lines.length} ໃບກວດນັບ
          </div>
        </div>
        <div className="shrink-0 rounded-lg bg-amber-50 px-3 py-1 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:ring-amber-800/60">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
            SML
          </span>
          <span className="ml-2 font-mono text-sm font-bold text-amber-900 dark:text-amber-100">
            {group.sml_unit ?? "—"}
          </span>
        </div>
        {canEdit && group.sml_unit && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              applySmlUnitToGroup();
            }}
            disabled={pending}
            className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? "ກຳລັງ update..." : "ໃຊ້ SML ທຸກໃບ"}
          </button>
        )}
      </summary>

      <div className="border-t border-zinc-100 bg-zinc-50/40 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/30">
        {updatedCount !== null && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:ring-emerald-800/60">
            <span>
              update ໃບກວດນັບແລ້ວ {updatedCount.toLocaleString("en-US")} ລາຍການ
            </span>
            <Link
              href={compareUrl}
              className="font-semibold text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-300"
            >
              ສົມທຽບໃໝ່ →
            </Link>
          </div>
        )}
        {error && (
          <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900/60">
            {error}
          </div>
        )}
        <ul className="space-y-2">
          {group.lines.map((l) => (
            <LineRow
              key={l.line_id}
              sessionId={sessionId}
              canEdit={canEdit}
              line={l}
              smlUnit={group.sml_unit}
              history={historyByLine[l.line_id] ?? []}
            />
          ))}
        </ul>

        {itemHistory.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-[11px] font-semibold text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
              ປະຫວັດການແກ້ໄຂຂອງສິນຄ້ານີ້ ({itemHistory.length})
            </summary>
            <HistoryList entries={itemHistory} />
          </details>
        )}
      </div>
    </details>
  );
}

function LineRow({
  sessionId,
  canEdit,
  line,
  smlUnit,
  history,
}: {
  sessionId: number;
  canEdit: boolean;
  line: LineEntry;
  smlUnit: string | null;
  history: HistoryEntry[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>(line.counted_unit ?? "");
  const [note, setNote] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(nextValue: string) {
    setError(null);
    startTransition(async () => {
      try {
        const compareUrl = `/stocktake/${sessionId}/report?scope=counted&filter=variance`;
        const res = await fetch(
          `/api/stocktake/sessions/${sessionId}/units`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              line_id: line.line_id,
              new_unit_code: nextValue.trim() || null,
              note: note.trim() || null,
            }),
          },
        );
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) {
          setError(data.error ?? "ບໍ່ສຳເລັດ");
          return;
        }
        setEditing(false);
        setNote("");
        router.prefetch(compareUrl);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
      }
    });
  }

  return (
    <li className="rounded-lg bg-white px-3 py-2 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1 text-xs">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
              {line.label_code}
            </span>
            <span className="text-zinc-500">
              qty:{" "}
              <b className="font-mono text-zinc-800 dark:text-zinc-200">
                {line.qty}
              </b>
            </span>
            <span className="text-zinc-500">
              ນັບ:{" "}
              <span className="rounded bg-red-50 px-1.5 py-0.5 font-mono font-bold text-red-700 dark:bg-red-950/40 dark:text-red-300">
                {line.counted_unit ?? "—"}
              </span>
            </span>
            <span className="text-zinc-400">≠</span>
            <span className="text-zinc-500">
              SML:{" "}
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                {smlUnit ?? "—"}
              </span>
            </span>
            <span className="text-[10px] text-zinc-400">
              {line.counted_at?.slice(0, 16)}
            </span>
          </div>
        </div>

        {canEdit && !editing && (
          <div className="flex shrink-0 gap-1.5">
            {smlUnit && (
              <button
                type="button"
                onClick={() => submit(smlUnit)}
                disabled={pending}
                className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {pending ? "ກຳລັງ..." : `ໃຊ້ ${smlUnit}`}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setValue(line.counted_unit ?? "");
                setEditing(true);
              }}
              disabled={pending}
              className="rounded-md bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              ແກ້ໄຂ…
            </button>
          </div>
        )}
      </div>

      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(value);
          }}
          className="mt-2 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-2 dark:border-zinc-800"
        >
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={20}
            placeholder="ຫົວໜ່ວຍໃໝ່"
            className="w-28 rounded-md border border-zinc-300 px-2 py-1 text-xs font-mono dark:border-zinc-700 dark:bg-zinc-950"
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="ໝາຍເຫດ (ຖ້າຈຳເປັນ)"
            className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-brand-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {pending ? "ກຳລັງ..." : "ບັນທຶກ"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setNote("");
              setError(null);
            }}
            disabled={pending}
            className="rounded-md px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            ຍົກເລີກ
          </button>
        </form>
      )}

      {error && (
        <div className="mt-2 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {history.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[10px] font-medium text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
            ປະຫວັດການແກ້ໄຂ ({history.length})
          </summary>
          <HistoryList entries={history} compact />
        </details>
      )}
    </li>
  );
}

function HistoryList({
  entries,
  compact,
}: {
  entries: HistoryEntry[];
  compact?: boolean;
}) {
  return (
    <ul
      className={`mt-2 space-y-1 ${compact ? "text-[10px]" : "text-[11px]"}`}
    >
      {entries.map((h) => (
        <li
          key={h.log_id}
          className="flex flex-wrap items-baseline gap-x-2 rounded bg-zinc-50 px-2 py-1 dark:bg-zinc-800/40"
        >
          <span className="font-mono text-zinc-400">
            {h.changed_at?.slice(0, 16)}
          </span>
          <span className="text-zinc-600 dark:text-zinc-300">
            {h.changed_by_name ?? "(ບໍ່ລະບຸ)"}
          </span>
          <span className="font-mono">
            <span className="rounded bg-red-50 px-1 text-red-700 dark:bg-red-950/30 dark:text-red-300">
              {h.old_unit_code ?? "—"}
            </span>
            <span className="mx-0.5 text-zinc-400">→</span>
            <span className="rounded bg-emerald-50 px-1 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
              {h.new_unit_code ?? "—"}
            </span>
          </span>
          {h.note && (
            <span className="italic text-zinc-500">«{h.note}»</span>
          )}
        </li>
      ))}
    </ul>
  );
}
