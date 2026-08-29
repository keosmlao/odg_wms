"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertIcon, CheckIcon, UndoIcon, XIcon } from "@/components/ui/Icons";
import { feedback } from "@/lib/feedback";

export type ToastTone = "ok" | "error" | "warn" | "info";

export type ToastOptions = {
  message: string;
  detail?: string;
  tone?: ToastTone;
  /** ms; ຄ່າເລີ່ມຕົ້ນ 4000, ຫຼື 6000 ເມື່ອມີປຸ່ມຍົກເລີກ. 0 = ຄ້າງໄວ້ຈົນກົດປິດ. */
  duration?: number;
  /**
   * ປຸ່ມ “ຍົກເລີກ” — ນີ້ຄືສິ່ງທີ່ມາແທນກ່ອງຖາມ “ແນ່ໃຈບໍ່?”.
   * ເຮັດວຽກເລີຍ ແລ້ວໃຫ້ໂອກາດຄືນຄ່າ ໄວກວ່າ ແລະ ປອດໄພກວ່າການໃຫ້ກົດຢືນຢັນທຸກເທື່ອ
   * ຊຶ່ງພໍໃຊ້ໄປດົນໆ ຄົນຈະກົດ “ຕົກລົງ” ໂດຍບໍ່ອ່ານ.
   */
  undo?: {
    label?: string;
    onUndo: () => void | Promise<void>;
  };
};

type ToastItem = ToastOptions & { id: number; duration: number };

type ToastApi = {
  show: (opts: ToastOptions) => number;
  dismiss: (id: number) => void;
};

const ToastCtx = createContext<ToastApi | null>(null);

/**
 * ໃຊ້ຈາກ client component ໃດກໍ່ໄດ້ທີ່ຢູ່ພາຍໃນ <ToastProvider>.
 * ຖ້າຢູ່ນອກ provider ຈະບໍ່ພັງ — ພຽງແຕ່ບໍ່ມີ toast ອອກ (ເຊັ່ນໜ້າພິມ).
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  return (
    ctx ?? {
      show: () => -1,
      dismiss: () => {},
    }
  );
}

const TONE_STYLE: Record<ToastTone, { ring: string; icon: React.ReactNode; bar: string }> = {
  ok: {
    ring: "ring-emerald-500/30",
    bar: "bg-emerald-500",
    icon: <CheckIcon className="h-4 w-4 text-emerald-400" />,
  },
  error: {
    ring: "ring-rose-500/30",
    bar: "bg-rose-500",
    icon: <AlertIcon className="h-4 w-4 text-rose-400" />,
  },
  warn: {
    ring: "ring-amber-500/30",
    bar: "bg-amber-500",
    icon: <AlertIcon className="h-4 w-4 text-amber-400" />,
  },
  info: {
    ring: "ring-aqua-500/30",
    bar: "bg-aqua-400",
    icon: <CheckIcon className="h-4 w-4 text-aqua-300" />,
  },
};

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((opts: ToastOptions) => {
    const id = nextId.current++;
    const duration = opts.duration ?? (opts.undo ? 6000 : 4000);
    // ສັ່ນ/ສຽງພ້ອມກັບ toast — ຄົນຮູ້ຜົນໂດຍບໍ່ຕ້ອງເບິ່ງຈໍ
    feedback(opts.tone === "error" ? "error" : opts.tone === "warn" ? "warn" : "ok");
    setItems((prev) => {
      // ຢ່າໃຫ້ toast ຊ້ອນກັນຫຼາຍຈົນບັງໜ້າຈໍ — ເກັບ 3 ອັນຫຼ້າສຸດ
      const next = [...prev, { ...opts, id, duration }];
      return next.length > 3 ? next.slice(next.length - 3) : next;
    });
    return id;
  }, []);

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[300] flex flex-col items-center gap-2 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-end sm:px-6"
      >
        {items.map((t) => (
          <ToastRow key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastRow({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const [undoing, setUndoing] = useState(false);
  const tone = TONE_STYLE[item.tone ?? "ok"];

  useEffect(() => {
    if (item.duration <= 0) return;
    const t = setTimeout(onDismiss, item.duration);
    return () => clearTimeout(t);
  }, [item.duration, onDismiss]);

  async function handleUndo() {
    if (!item.undo || undoing) return;
    setUndoing(true);
    try {
      await item.undo.onUndo();
      feedback("done");
    } finally {
      onDismiss();
    }
  }

  return (
    <div
      role="status"
      className={`animate-toast-in pointer-events-auto relative w-full max-w-md overflow-hidden rounded-2xl bg-zinc-900 text-white shadow-2xl ring-1 ${tone.ring} dark:bg-zinc-800`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="shrink-0">{tone.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{item.message}</p>
          {item.detail && (
            <p className="truncate text-xs text-zinc-400">{item.detail}</p>
          )}
        </div>
        {item.undo && (
          <button
            type="button"
            onClick={handleUndo}
            disabled={undoing}
            className="tap-auto inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-sm font-bold text-aqua-300 transition hover:bg-white/20 disabled:opacity-50"
          >
            <UndoIcon className="h-4 w-4" />
            {undoing ? "ກຳລັງຄືນ..." : (item.undo.label ?? "ຍົກເລີກ")}
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="ປິດ"
          className="tap-auto shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/10 hover:text-white"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>
      {/* ແຖບເວລາ — ເຫັນວ່າຍັງເຫຼືອເວລາຍົກເລີກອີກເທົ່າໃດ ບໍ່ຕ້ອງເດົາ */}
      {item.duration > 0 && (
        <div
          className={`h-1 origin-left ${tone.bar}`}
          style={{
            animation: `wms-undo-bar ${item.duration}ms linear forwards`,
          }}
        />
      )}
    </div>
  );
}
