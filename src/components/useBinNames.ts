"use client";

import { useEffect, useState } from "react";
import { EMPTY_NAMES, nameBookOf, type NameBook } from "@/lib/locationLabel";

/**
 * ຊື່ຂອງ rack/location ຂອງສາງໜຶ່ງ — ໄວ້ສະແດງແທນລະຫັດດິບ.
 *
 * ດຶງຈາກ `/api/stocktake/locations` ຊຶ່ງເປັນ master ນ້ອຍ ແລະ ບໍ່ຄ່ອຍປ່ຽນ ຈຶ່ງ
 * ເກັບ cache ໄວ້ໃນໂມດູນ — ຫຼາຍໜ້າ/ຫຼາຍຄອມໂປເນັນທີ່ໃຊ້ສາງດຽວກັນ ຍິງຄຳຮ້ອງດຽວ.
 *
 * ຄືນ NameBook ວ່າງລະຫວ່າງລໍ ຫຼື ເມື່ອດຶງບໍ່ໄດ້ — ໜ້າຈໍຈຶ່ງຕົກກັບໄປສະແດງລະຫັດ
 * ຄືເກົ່າ ບໍ່ແມ່ນຄ້າງເປົ່າ.
 */
const cache = new Map<string, NameBook>();
const inflight = new Map<string, Promise<NameBook>>();

async function load(wh: string): Promise<NameBook> {
  const hit = cache.get(wh);
  if (hit) return hit;
  const running = inflight.get(wh);
  if (running) return running;

  const p = (async () => {
    try {
      const res = await fetch(`/api/stocktake/locations?wh=${encodeURIComponent(wh)}`);
      const data = (await res.json()) as {
        racks?: { code: string; name: string | null }[];
        locations?: { code: string; name: string | null }[];
      };
      const book = nameBookOf(data.racks ?? [], data.locations ?? []);
      cache.set(wh, book);
      return book;
    } catch {
      return EMPTY_NAMES;
    } finally {
      inflight.delete(wh);
    }
  })();
  inflight.set(wh, p);
  return p;
}

function merge(books: NameBook[]): NameBook {
  if (books.length === 1) return books[0];
  const out: NameBook = { rack: new Map(), loc: new Map() };
  for (const b of books) {
    for (const [k, v] of b.rack) out.rack.set(k, v);
    for (const [k, v] of b.loc) out.loc.set(k, v);
  }
  return out;
}

/**
 * ຮັບໄດ້ທັງສາງດຽວ ແລະ ຫຼາຍສາງ. ລວມເປັນເຫຼັ້ມດຽວໂດຍບໍ່ຕິດລະຫັດສາງນຳ ເພາະລະຫັດ
 * rack/location ຝັງລະຫັດສາງໄວ້ໃນຕົວມັນຢູ່ແລ້ວ (120213, 120213-Z02) ຈຶ່ງບໍ່ຊ້ຳກັນ.
 */
export function useBinNames(wh: string | string[] | null | undefined): NameBook {
  const key = Array.isArray(wh) ? [...new Set(wh.filter(Boolean))].sort().join(",") : (wh ?? "");

  const [book, setBook] = useState<NameBook>(EMPTY_NAMES);

  useEffect(() => {
    const codes = key ? key.split(",") : [];
    if (codes.length === 0) {
      setBook(EMPTY_NAMES);
      return;
    }
    let cancelled = false;
    void Promise.all(codes.map(load)).then((books) => {
      if (!cancelled) setBook(merge(books));
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return book;
}
