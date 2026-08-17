"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckIcon, EyeIcon, EyeOffIcon, UserIcon } from "@/components/ui/Icons";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: { preventDefault: () => void }) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError("ກະລຸນາປ້ອນລະຫັດພະນັກງານ ແລະ ລະຫັດຜ່ານ");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
      if (!res.ok) {
        setError(data.error ?? "ເຂົ້າສູ່ລະບົບບໍ່ສຳເລັດ");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("ບໍ່ສາມາດເຊື່ອມຕໍ່ກັບເຊີບເວີໄດ້");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid flex-1 lg:grid-cols-2">
      {/* Brand panel (desktop) */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-900 via-brand-600 to-aqua-500 p-12 text-white lg:flex">
        <div aria-hidden className="pointer-events-none absolute -top-32 -right-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 -left-24 h-[28rem] w-[28rem] rounded-full bg-sunset-400/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:40px_40px]" />

        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 text-sm font-bold tracking-tight ring-1 ring-white/30 backdrop-blur">
            ODG
          </div>
          <span className="text-lg font-semibold tracking-tight">ODG WMS</span>
        </div>

        <div className="relative">
          <h2 className="max-w-md text-4xl font-bold leading-tight tracking-tight">
            ຄຸ້ມຄອງຄັງສິນຄ້າ<br />ຢ່າງມືອາຊີບ
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-brand-100">
            ຕິດຕາມຄົງເຫຼືອ, ປັບປຸງສະຕ໋ອກ ແລະ ບໍລິຫານ serial number — ທຸກຢ່າງໃນລະບົບດຽວ.
          </p>
          <ul className="mt-8 space-y-3 text-sm">
            {[
              "ຕິດຕາມສິນຄ້າຄົງເຫຼືອຕາມ location",
              "ປັບປຸງສະຕ໋ອກ ພ້ອມຫຼັກຖານ",
              "ບໍລິຫານ & ຄົ້ນຫາ Serial Number",
            ].map((f) => (
              <li key={f} className="flex items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25">
                  <CheckIcon className="h-3.5 w-3.5" />
                </span>
                {f}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative text-xs text-brand-200/80">
          © {new Date().getFullYear()} ODG WMS · ສະຫງວນລິຂະສິດ
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-zinc-50 px-6 py-12 dark:bg-zinc-950">
        <div className="w-full max-w-sm">
          {/* mobile brand */}
          <div className="mb-8 text-center lg:text-left">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-900 via-brand-500 to-aqua-400 text-sm font-bold text-white shadow-lg shadow-brand-500/30 lg:hidden">
              ODG
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">ເຂົ້າສູ່ລະບົບ</h1>
            <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">ປ້ອນລະຫັດພະນັກງານ ເພື່ອເຂົ້າໃຊ້ ODG WMS</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                ລະຫັດພະນັກງານ
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
                  <UserIcon className="h-4 w-4" />
                </span>
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-xl bg-white py-3 pl-9 pr-3 text-sm text-zinc-900 shadow-sm ring-1 ring-zinc-200 outline-none transition placeholder:text-zinc-400 hover:ring-zinc-300 focus:ring-2 focus:ring-brand-500 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-800 dark:focus:ring-brand-400"
                  placeholder="ປ້ອນລະຫັດພະນັກງານ"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                ລະຫັດຜ່ານ
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
                  <LockIcon className="h-4 w-4" />
                </span>
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl bg-white py-3 pl-9 pr-10 text-sm text-zinc-900 shadow-sm ring-1 ring-zinc-200 outline-none transition placeholder:text-zinc-400 hover:ring-zinc-300 focus:ring-2 focus:ring-brand-500 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-800 dark:focus:ring-brand-400"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  aria-label={showPassword ? "ເຊື່ອງລະຫັດ" : "ສະແດງລະຫັດ"}
                >
                  {showPassword ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
                <input type="checkbox" className="h-3.5 w-3.5 rounded border-zinc-300 text-brand-600 focus:ring-brand-500 dark:border-zinc-700" />
                ຈື່ຂ້ອຍໄວ້
              </label>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-400 dark:ring-red-900/50">
                <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4m0 4h.01" strokeLinecap="round" /><circle cx="12" cy="12" r="9" /></svg>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-900 via-brand-500 to-aqua-400 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/30 transition hover:shadow-xl hover:shadow-brand-500/40 active:scale-[0.99] disabled:opacity-60"
            >
              {submitting && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              )}
              {submitting ? "ກຳລັງເຂົ້າສູ່ລະບົບ..." : "ເຂົ້າສູ່ລະບົບ"}
            </button>
          </form>

          <p className="mt-8 text-center text-xs text-zinc-400 lg:hidden">
            © {new Date().getFullYear()} ODG WMS
          </p>
        </div>
      </div>
    </div>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
