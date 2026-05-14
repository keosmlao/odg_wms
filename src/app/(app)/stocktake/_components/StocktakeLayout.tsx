import type { ReactNode } from "react";
import { stContainer, stContainerWide, stPage } from "./stocktake-theme";

export default function StocktakeLayout({
  children,
  wide,
}: {
  children: ReactNode;
  /** ໜ້ານັບປ້າຍໃຊ້ຄວາມກວ້າງເພີ່ມ */
  wide?: boolean;
}) {
  return (
    <div className={stPage}>
      <div className={wide ? stContainerWide : stContainer}>{children}</div>
    </div>
  );
}
