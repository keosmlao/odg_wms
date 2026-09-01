"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@/lib/session-shared";
import { flattenNav, matchNav, quickActions, type NavHit } from "@/lib/nav";
import { CommandIcon, SearchIcon } from "@/components/ui/Icons";
import { feedback } from "@/lib/feedback";

const RECENT_KEY = "wms.recentNav";
const MAX_RECENT = 4;

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function pushRecent(href: string) {
  try {
    const next = [href, ...readRecent().filter((h) => h !== href)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
}

/**
 * ຄົ້ນຫາຄຳສັ່ງ — ພິມ “ໂອນ” ແລ້ວກົດ Enter ໄປໄດ້ເລີຍ.
 *
 * ແຖບຂ້າງມີເມນູ 9 ກຸ່ມ ຫຼາຍສິບໜ້າ; ຄົນໃໝ່ຈື່ບໍ່ໄດ້ວ່າໜ້າໃດຢູ່ກຸ່ມໃດ ແຕ່ຈື່ຊື່ໜ້າໄດ້.
 * ເປີດດ້ວຍ Ctrl+K / ⌘K ຫຼື ກົດປຸ່ມຄົ້ນຫາເທິງແຖບເທິງ.
 */
export default function CommandPalette({ session }: { session: Session | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const all = useMemo(() => flattenNav(session), [session]);

  const results = useMemo(() => {
    if (!q.trim()) {
      // ບໍ່ມີຄຳຄົ້ນຫາ → ສະແດງໜ້າທີ່ເປີດຫຼ້າສຸດ ແລ້ວຕໍ່ດ້ວຍວຽກປະຈຳວັນ
      const recentHits = recent
        .map((href) => all.find((h) => h.href === href))
        .filter((h): h is NavHit => Boolean(h));
      const quick = quickActions
        .map((a) => all.find((h) => h.href === a.href) ?? { ...a, group: null })
        .filter((h) => !recentHits.some((r) => r.href === h.href));
      return [...recentHits, ...quick].slice(0, 8);
    }
    return all.filter((h) => matchNav(h, q)).slice(0, 12);
  }, [all, q, recent]);

  // ເປີດ/ປິດດ້ວຍແປ້ນພິມ. ໃຊ້ capture ເພື່ອໃຫ້ຊະນະຊ່ອງຍິງບາໂຄດທີ່ focus ຄ້າງໄວ້.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setRecent(readRecent());
    setQ("");
    setCursor(0);
    // ໃຫ້ modal render ກ່ອນຈຶ່ງ focus
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    setCursor(0);
  }, [q]);

  // ເລື່ອນລາຍການໃຫ້ແຖວທີ່ເລືອກຢູ່ໃນສາຍຕາສະເໝີ
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  function go(href: string) {
    pushRecent(href);
    feedback("tap");
    setOpen(false);
    router.push(href);
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[cursor];
      if (hit) go(hit.href);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full border border-zinc-200/60 bg-white/70 py-1.5 pl-3 pr-2 text-xs font-medium text-zinc-500 transition hover:border-brand-300 hover:text-brand-600 dark:border-zinc-700/60 dark:bg-zinc-800/60 dark:text-zinc-400 dark:hover:border-brand-600 dark:hover:text-aqua-300"
        aria-label="ຄົ້ນຫາໜ້າ ແລະ ຄຳສັ່ງ"
      >
        <SearchIcon className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">ຄົ້ນຫາໜ້າ...</span>
        <kbd className="hidden items-center gap-0.5 rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-500 sm:inline-flex dark:bg-zinc-700 dark:text-zinc-300">
          <CommandIcon className="h-2.5 w-2.5" />K
        </kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-[250] flex items-start justify-center p-4 pt-[10vh]">
          <button
            type="button"
            aria-label="ປິດ"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-zinc-900/50 backdrop-blur-sm"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="ຄົ້ນຫາໜ້າ ແລະ ຄຳສັ່ງ"
            className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800"
          >
            <div className="flex items-center gap-3 border-b border-zinc-100 px-4 dark:border-zinc-800">
              <SearchIcon className="h-4 w-4 shrink-0 text-zinc-400" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="ພິມຊື່ໜ້າ ເຊັ່ນ “ໂອນ”, “ນັບ”, “ຮັບ”..."
                className="w-full bg-transparent py-4 text-base text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
              />
            </div>

            <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
              {!q.trim() && (
                <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  {recent.length > 0 ? "ຫຼ້າສຸດ & ວຽກປະຈຳວັນ" : "ວຽກປະຈຳວັນ"}
                </p>
              )}
              {results.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-zinc-500">
                  ບໍ່ພົບ &quot;{q}&quot;
                </p>
              )}
              {results.map((hit, i) => (
                <Link
                  key={hit.href}
                  href={hit.href}
                  data-idx={i}
                  onClick={(e) => {
                    e.preventDefault();
                    go(hit.href);
                  }}
                  onMouseEnter={() => setCursor(i)}
                  className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition ${
                    i === cursor
                      ? "bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-aqua-200"
                      : "text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  <span className="shrink-0 text-zinc-400">{hit.icon}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{hit.label}</span>
                  {hit.group && (
                    <span className="hidden shrink-0 truncate text-xs text-zinc-400 sm:inline">
                      {hit.group}
                    </span>
                  )}
                </Link>
              ))}
            </div>

            <div className="hidden items-center gap-4 border-t border-zinc-100 px-4 py-2 text-[10px] text-zinc-400 sm:flex dark:border-zinc-800">
              <span>↑↓ ເລືອກ</span>
              <span>↵ ເປີດ</span>
              <span>Esc ປິດ</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
