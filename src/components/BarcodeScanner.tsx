"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Camera-based barcode/QR scanner overlay. Uses ZXing via @zxing/browser.
 *
 * Calls onDetect once with the decoded text, then auto-closes.
 * Click backdrop or close button to dismiss without scanning.
 */
export default function BarcodeScanner({
  onDetect,
  onClose,
}: {
  onDetect: (text: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Dynamic import keeps the bundle small for users who never scan.
    let controlsRef: { stop: () => void } | null = null;

    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        if (!videoRef.current) return;
        if (cancelled) return;

        const controls = await reader.decodeFromVideoDevice(
          undefined, // let the library pick (prefers back camera on mobile)
          videoRef.current,
          (result, _err) => {
            if (cancelled) return;
            if (result) {
              const text = result.getText();
              if (text) {
                if (typeof navigator !== "undefined" && "vibrate" in navigator) {
                  navigator.vibrate(60);
                }
                onDetect(text);
              }
            }
          },
        );
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef = controls;
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        const msg =
          e instanceof Error ? e.message : "ບໍ່ສາມາດເປີດກ້ອງ";
        setErrorMsg(msg);
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      try {
        controlsRef?.stop();
      } catch {
        // ignore
      }
    };
  }, [onDetect]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black"
      role="dialog"
      aria-modal="true"
      aria-label="ສະແກນ barcode"
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 text-white">
        <span className="text-sm font-semibold">ສະແກນ barcode</span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-full text-white/80 hover:bg-white/10"
          aria-label="ປິດ"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Camera area */}
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          playsInline
          muted
        />

        {/* Scan frame overlay */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-64 w-64 sm:h-80 sm:w-80">
            <div className="absolute -inset-0.5 rounded-2xl border-2 border-white/40" />
            <div className="absolute -top-1 -left-1 h-8 w-8 rounded-tl-2xl border-l-4 border-t-4 border-white" />
            <div className="absolute -top-1 -right-1 h-8 w-8 rounded-tr-2xl border-r-4 border-t-4 border-white" />
            <div className="absolute -bottom-1 -left-1 h-8 w-8 rounded-bl-2xl border-l-4 border-b-4 border-white" />
            <div className="absolute -bottom-1 -right-1 h-8 w-8 rounded-br-2xl border-r-4 border-b-4 border-white" />
          </div>
        </div>

        {/* Status overlay */}
        {status !== "ready" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 px-6 text-center text-white">
            {status === "loading" ? (
              <div>
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                <p className="mt-3 text-sm">ກຳລັງເປີດກ້ອງ...</p>
              </div>
            ) : (
              <div>
                <p className="text-base font-semibold">ບໍ່ສາມາດເປີດກ້ອງ</p>
                {errorMsg && (
                  <p className="mx-auto mt-2 max-w-sm text-xs text-white/70">
                    {errorMsg}
                  </p>
                )}
                <p className="mt-3 text-xs text-white/60">
                  ກະລຸນາອະນຸຍາດການເຂົ້າເຖິງກ້ອງ ແລ້ວລອງໃໝ່
                </p>
                <button
                  type="button"
                  onClick={onClose}
                  className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black"
                >
                  ປິດ
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Hint */}
      <div className="bg-black px-5 py-3 text-center text-xs text-white/70">
        ຈ່ອງ barcode / QR ໃຫ້ຢູ່ໃນກອບ — ສະແກນອັດຕະໂນມັດ
      </div>
    </div>
  );
}
