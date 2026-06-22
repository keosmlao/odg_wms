import "server-only";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Canonical matcher for `odg_wms_ph_dimension`.
 *
 * PH rows may define only some inventory attributes. NULL means wildcard;
 * non-NULL (including an intentional empty string) must match exactly. The
 * most-specific matching row wins, then the earliest roworder.
 */
export function phDimensionLateralJoin(
  inventoryAlias: string,
  resultAlias = "ph",
) {
  if (!IDENTIFIER.test(inventoryAlias) || !IDENTIFIER.test(resultAlias)) {
    throw new Error("Invalid SQL alias for PH dimension matcher");
  }

  return `
    LEFT JOIN LATERAL (
      SELECT
        NULLIF(p.pallet, 0)::numeric AS pallet,
        NULLIF(p.stack, 0)::numeric AS stack,
        p.roworder AS ph_roworder
      FROM public.odg_wms_ph_dimension p
      WHERE (p.group_main IS NULL OR TRIM(p.group_main) = COALESCE(TRIM(${inventoryAlias}.group_main), ''))
        AND (p.group_sub IS NULL OR TRIM(p.group_sub) = COALESCE(TRIM(${inventoryAlias}.group_sub), ''))
        AND (p.group_sub2 IS NULL OR TRIM(p.group_sub2) = COALESCE(TRIM(${inventoryAlias}.group_sub2), ''))
        AND (p.item_category IS NULL OR TRIM(p.item_category) = COALESCE(TRIM(${inventoryAlias}.item_category), ''))
        AND (p.item_brand IS NULL OR TRIM(p.item_brand) = COALESCE(TRIM(${inventoryAlias}.item_brand), ''))
        AND (p.item_pattern IS NULL OR TRIM(p.item_pattern) = COALESCE(TRIM(${inventoryAlias}.item_pattern), ''))
        AND (p.item_size IS NULL OR TRIM(p.item_size) = COALESCE(TRIM(${inventoryAlias}.item_size), ''))
        AND (p.item_design IS NULL OR TRIM(p.item_design) = COALESCE(TRIM(${inventoryAlias}.item_design), ''))
        AND (p.item_air IS NULL OR TRIM(p.item_air) = COALESCE(TRIM(${inventoryAlias}.item_air), ''))
      ORDER BY
        ((p.group_main IS NOT NULL)::int +
         (p.group_sub IS NOT NULL)::int +
         (p.group_sub2 IS NOT NULL)::int +
         (p.item_category IS NOT NULL)::int +
         (p.item_brand IS NOT NULL)::int +
         (p.item_pattern IS NOT NULL)::int +
         (p.item_size IS NOT NULL)::int +
         (p.item_design IS NOT NULL)::int +
         (p.item_air IS NOT NULL)::int) DESC,
        p.roworder
      LIMIT 1
    ) ${resultAlias} ON true
  `;
}

