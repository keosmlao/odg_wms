------------------------------------------------------------
-- 026: Per-user permissions on top of the WMS role
--
-- Role (manager / supervisor / keeper) says WHAT part of the warehouse someone
-- works in; it says nothing about whether they may VOID a posted document.
-- Deleting a transfer reverses stock, serials and the ERP ໃບໂອນ, so it needs to
-- be handed out per person rather than implied by a role.
--
-- Permissions live here as one row per (employee, perm). A manager is not listed
-- and does not need to be — a manager implicitly holds every permission.
--
-- NOTE: after this migration a supervisor/keeper can no longer delete a transfer
-- doc until a manager grants it in ຈັດການສິດເຂົ້າເຖິງ. That is the point of the
-- change; nothing is seeded on purpose.
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.wms_user_permission (
  employee_id integer     NOT NULL,
  perm        varchar(40) NOT NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  granted_by  varchar(50),
  PRIMARY KEY (employee_id, perm)
);

COMMENT ON TABLE public.wms_user_permission
  IS 'ສິດເພີ່ມເຕີມຕໍ່ພະນັກງານ (ນອກເໜືອຈາກ role) — ເຊັ່ນ ລົບໃບໂອນອອກ / ໂອນເຂົ້າ. ຜູ້ຈັດການມີທຸກສິດໂດຍປະລິຍາຍ.';
COMMENT ON COLUMN public.wms_user_permission.perm
  IS 'delete_transfer_out = ລົບໃບໂອນອອກ · delete_transfer_in = ລົບໃບໂອນເຂົ້າ/ຮັບຄືນ';

CREATE INDEX IF NOT EXISTS idx_wms_user_permission_emp ON public.wms_user_permission (employee_id);
