"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EyeIcon, EyeOffIcon, UserIcon } from "@/components/ui/Icons";

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
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
      };
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
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-zinc-50 px-4 py-12 dark:bg-zinc-950">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full bg-gradient-to-br from-indigo-300/40 via-violet-300/30 to-transparent blur-3xl dark:from-indigo-600/20 dark:via-violet-600/15"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 -bottom-40 h-96 w-96 rounded-full bg-gradient-to-tl from-pink-300/30 via-rose-300/20 to-transparent blur-3xl dark:from-pink-600/15 dark:via-rose-600/10"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-emerald-200/20 to-cyan-200/20 blur-3xl dark:from-emerald-600/10 dark:to-cyan-600/10"
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-purple-600 text-base font-bold tracking-tight text-white shadow-xl shadow-indigo-500/40">
            ODG
          </div>
          <h1 className="bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-700 bg-clip-text text-3xl font-semibold tracking-tight text-transparent dark:from-zinc-50 dark:via-zinc-100 dark:to-zinc-300">
            ເຂົ້າສູ່ລະບົບ
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            ລະບົບຄຸ້ມຄອງຄັງສິນຄ້າ ODG WMS
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="shadow-card-lg rounded-2xl bg-white/80 p-7 ring-1 ring-zinc-200/70 backdrop-blur-xl dark:bg-zinc-900/80 dark:ring-zinc-800/70"
        >
          <div className="space-y-4">
            <div>
              <label
                htmlFor="username"
                className="mb-1.5 block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
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
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-xl bg-white py-2.5 pl-9 pr-3 text-sm text-zinc-900 shadow-sm ring-1 ring-zinc-200 outline-none transition placeholder:text-zinc-400 hover:ring-zinc-300 focus:ring-2 focus:ring-indigo-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800 dark:hover:ring-zinc-700 dark:focus:ring-indigo-400"
                  placeholder="ປ້ອນລະຫັດພະນັກງານ"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                ລະຫັດຜ່ານ
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl bg-white px-3 py-2.5 pr-10 text-sm text-zinc-900 shadow-sm ring-1 ring-zinc-200 outline-none transition placeholder:text-zinc-400 hover:ring-zinc-300 focus:ring-2 focus:ring-indigo-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800 dark:hover:ring-zinc-700 dark:focus:ring-indigo-400"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  aria-label={showPassword ? "ເຊື່ອງລະຫັດ" : "ສະແດງລະຫັດ"}
                >
                  {showPassword ? (
                    <EyeOffIcon className="h-4 w-4" />
                  ) : (
                    <EyeIcon className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-700"
                />
                ຈື່ຂ້ອຍໄວ້
              </label>
              <a
                href="#"
                className="font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
              >
                ລືມລະຫັດຜ່ານ?
              </a>
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-400 dark:ring-red-900/50">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:shadow-xl hover:shadow-indigo-500/40 active:from-indigo-600 active:via-violet-600 active:to-purple-700 disabled:opacity-60"
            >
              {submitting ? "ກຳລັງເຂົ້າສູ່ລະບົບ..." : "ເຂົ້າສູ່ລະບົບ"}
            </button>
          </div>
        </form>

        <p className="mt-6 text-center text-xs text-zinc-500 dark:text-zinc-500">
          © {new Date().getFullYear()} ODG WMS · ສະຫງວນລິຂະສິດ
        </p>
      </div>
    </div>
  );
}
