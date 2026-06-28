"use client";
import { useEffect } from "react";

export default function AutoPrint({ auto }: { auto?: boolean }) {
  useEffect(() => {
    if (!auto) return;
    let printed = false;
    const go = () => { if (printed) return; printed = true; window.print(); };
    // Print only once the page is fully laid out AND the Lao webfont has loaded —
    // firing too early captures a blank/unstyled snapshot.
    const trigger = () => {
      const fonts = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
      if (fonts && typeof fonts.then === "function") fonts.then(() => setTimeout(go, 150));
      else setTimeout(go, 400);
    };
    if (document.readyState === "complete") trigger();
    else window.addEventListener("load", trigger, { once: true });
    return () => window.removeEventListener("load", trigger);
  }, [auto]);
  return (
    <div className="no-print mb-4 flex gap-2">
      <button onClick={() => window.print()} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700 cursor-pointer">🖨 ພິມ</button>
      <button onClick={() => window.close()} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 cursor-pointer">ປິດ</button>
    </div>
  );
}
