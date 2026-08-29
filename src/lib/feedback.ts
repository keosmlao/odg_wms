/**
 * ການຕອບກັບທັນທີ — ສັ່ນ + ສຽງ.
 *
 * ນີ້ຄືສິ່ງທີ່ເຮັດໃຫ້ແອັບ “ຮູ້ສຶກດີ” ຫຼາຍກວ່າສີ ໂດຍສະເພາະຄົນທີ່ໂຕໃຫຍ່ມາກັບມືຖື:
 * ກົດ/ຍິງແລ້ວຕ້ອງມີບາງຢ່າງເກີດຂຶ້ນ **ພາຍໃນ 100ms** ບໍ່ໃຫ້ຄົນສົງໄສວ່າຕິດຫຼືບໍ່.
 *
 * ໃນສາງມີສຽງດັງ ແລະ ຄົນໃສ່ຖົງມື — ສັ່ນຢ່າງດຽວບາງເທື່ອບໍ່ຮູ້ສຶກ, ສຽງຢ່າງດຽວບາງເທື່ອ
 * ບໍ່ໄດ້ຍິນ. ຈຶ່ງໃຫ້ທັງສອງພ້ອມກັນ ແລະ ໃຫ້ປິດສຽງໄດ້ຕ່າງຫາກ.
 *
 * ໃຊ້ WebAudio ອອກສຽງເອງ ບໍ່ໂຫຼດໄຟລ໌ສຽງ — ບໍ່ມີ request ເພີ່ມ ແລະ ດັງທັນທີ.
 */
export type FeedbackKind = "ok" | "error" | "warn" | "tap" | "done";

const SOUND_KEY = "wms.sound";

/** ຮູບແບບການສັ່ນຕໍ່ແຕ່ລະເຫດການ (ms). ຜິດພາດ = ສອງຈັງຫວະ ຮູ້ໄດ້ໂດຍບໍ່ຕ້ອງເບິ່ງຈໍ. */
const VIBRATE: Record<FeedbackKind, number | number[]> = {
  ok: 35,
  error: [60, 40, 60],
  warn: [30, 30, 30],
  tap: 12,
  done: [40, 30, 90],
};

/** ໂຕນສຽງ: [ຄວາມຖີ່ Hz, ໄລຍະ ms][] — ຂຶ້ນ = ສຳເລັດ, ລົງ = ຜິດພາດ. */
const TONES: Record<FeedbackKind, [number, number][]> = {
  ok: [[880, 70]],
  error: [
    [320, 110],
    [220, 150],
  ],
  warn: [[520, 90]],
  tap: [[660, 30]],
  done: [
    [660, 70],
    [880, 70],
    [1180, 110],
  ],
};

let audioCtx: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!audioCtx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
    }
    // ບາງ browser ໂຈະ context ໄວ້ຈົນກວ່າຈະມີການແຕະຈໍ
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    /* private mode */
  }
}

function beep(kind: FeedbackKind) {
  if (!soundEnabled()) return;
  const ac = ctx();
  if (!ac) return;
  let at = ac.currentTime;
  for (const [freq, ms] of TONES[kind]) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    // envelope ສັ້ນໆ — ບໍ່ໃຫ້ມີສຽງ “ຄິກ” ຕອນເລີ່ມ/ຈົບ
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.09, at + 0.008);
    gain.gain.setValueAtTime(0.09, at + ms / 1000 - 0.02);
    gain.gain.linearRampToValueAtTime(0, at + ms / 1000);
    osc.connect(gain).connect(ac.destination);
    osc.start(at);
    osc.stop(at + ms / 1000);
    at += ms / 1000;
  }
}

export function vibrate(kind: FeedbackKind) {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try {
    navigator.vibrate(VIBRATE[kind]);
  } catch {
    /* some browsers throw when the page is not visible */
  }
}

/**
 * ຕອບກັບຄົນໃຊ້ — ສັ່ນ ແລະ ອອກສຽງພ້ອມກັນ.
 * ເອີ້ນໄດ້ຈາກທຸກບ່ອນ ບໍ່ຈຳເປັນຕ້ອງເປັນ React component.
 */
export function feedback(kind: FeedbackKind) {
  vibrate(kind);
  beep(kind);
}
