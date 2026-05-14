"use client";

/**
 * Minimal client-side queue for stocktake line POSTs that survive a
 * network drop. Stored in localStorage so it persists across page
 * reloads. Items are flushed in order when the browser is online.
 *
 * Scope: only "add line" mutations are queueable. Edits/deletes
 * require online (they target a server-assigned line_id).
 */

const STORAGE_KEY = "wms_stocktake_offline_queue_v1";

export type QueuedLine = {
  /** Local-only ID (negative number) so the UI can render it before sync. */
  local_id: number;
  /** Server label_id this line belongs to. */
  label_id: number;
  /** Session id (for filtering / display). */
  session_id: number;
  /** Payload the server expects. */
  payload: {
    item_code: string;
    item_name: string | null;
    unit_code: string | null;
    qty: number;
    note?: string;
    rack_code: string | null;
    location_code: string | null;
  };
  /** ISO timestamp queued at. */
  queued_at: string;
  /** Number of failed retry attempts. */
  attempts: number;
  /** Last error message (if any). */
  last_error?: string;
};

function read(): QueuedLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as QueuedLine[]) : [];
  } catch {
    return [];
  }
}

function write(items: QueuedLine[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // localStorage full or unavailable; ignore.
  }
}

let nextLocalId = -1;
function allocLocalId(): number {
  // Negative IDs to distinguish from server line_ids.
  const id = nextLocalId;
  nextLocalId -= 1;
  return id;
}

export function enqueue(
  item: Omit<QueuedLine, "local_id" | "queued_at" | "attempts">,
): QueuedLine {
  const queued: QueuedLine = {
    ...item,
    local_id: allocLocalId(),
    queued_at: new Date().toISOString(),
    attempts: 0,
  };
  const all = read();
  all.push(queued);
  write(all);
  return queued;
}

export function getAll(): QueuedLine[] {
  return read();
}

export function getForLabel(labelId: number): QueuedLine[] {
  return read().filter((q) => q.label_id === labelId);
}

export function remove(localId: number): void {
  write(read().filter((q) => q.local_id !== localId));
}

export function size(): number {
  return read().length;
}

/**
 * Replay queued items against the server. Resolves when the queue is
 * fully drained OR a request fails (in which case the failing item
 * stays in the queue with an incremented attempt counter).
 *
 * Returns counters so the UI can report progress.
 */
export async function flush(): Promise<{
  succeeded: Array<{ local_id: number; server_line: unknown }>;
  failed: Array<{ local_id: number; error: string }>;
}> {
  const succeeded: Array<{ local_id: number; server_line: unknown }> = [];
  const failed: Array<{ local_id: number; error: string }> = [];

  // Process sequentially so order is preserved per label.
  for (;;) {
    const all = read();
    const next = all[0];
    if (!next) break;

    try {
      const res = await fetch(`/api/stocktake/labels/${next.label_id}/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next.payload),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        line?: unknown;
      };
      if (!res.ok || !data.ok || !data.line) {
        throw new Error(data.error ?? "ສົ່ງບໍ່ສຳເລັດ");
      }
      // Success — pop the head and record.
      const rest = all.slice(1);
      write(rest);
      succeeded.push({ local_id: next.local_id, server_line: data.line });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "network error";
      // Stop on first failure: avoid hammering the server and preserve order.
      const updated = read();
      if (updated[0]) {
        updated[0] = {
          ...updated[0],
          attempts: updated[0].attempts + 1,
          last_error: msg,
        };
        write(updated);
      }
      failed.push({ local_id: next.local_id, error: msg });
      break;
    }
  }

  return { succeeded, failed };
}

export function clear(): void {
  write([]);
}
