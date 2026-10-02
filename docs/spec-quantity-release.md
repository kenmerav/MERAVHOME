# Spec Book quantities — release

The requested choices are **Count**, **Sq Ft**, and **TBD** for an unknown amount.
Quantity remains numeric (now allowing decimal square feet); `quantity_tbd` is a
separate boolean, and `quantity_unit` defaults to `count`. Existing quantities,
selections, notes, prices, files, and approvals are not changed by the migration.
Blank legacy quantities remain blank rather than being automatically marked TBD.

## Deployment order / review

1. Review `supabase/migrations/20261002214216_add_spec_quantity_units.sql`.
   It widens `material_items.quantity` from integer to numeric, adds the unit/TBD
   columns, and adds a quantity-edit guard. It does not weaken any existing RLS
   policy. The guard uses verified database profiles/assignments and the existing
   Spec Book editor roles, including assigned contractors and the existing
   explicitly allowed editor account. Public links and ordinary clients remain
   read-only for quantities. Trusted service-role imports remain supported.
2. Before production application, confirm a recent recoverable backup, check
   dependent views/functions and existing quantities, and schedule a quiet
   window. Type widening may require a brief table lock/rewrite. The migration
   fails rather than waiting indefinitely for a lock (5-second lock timeout).
3. Apply only this reviewed migration to the correct Studio database, not all
   unrelated migrations. Applied to Studio production with explicit user approval
   on 2026-10-02, server migration version `20261002214216`.
4. Run the Supabase advisors and verify a real authorized staff save plus public,
   ordinary client, inactive-account, and cross-project write rejection.
5. Deploy the focused application changes only after database verification.

## Rollback

An application rollback can leave the numeric quantity type and added fields in
place without losing information. Do not cast decimal areas back to integer or
drop the TBD/unit fields after users save data. Retain the guard and metadata and
prepare a separately reviewed forward correction if needed. Existing code that
tries to set a number on a TBD row without clearing TBD will be rejected rather
than silently leaving contradictory values.

## Behavior / limitations

- Edit Qty or Unit in either spreadsheet grouping; click Qty on a book card or
  Materials row. Enter a number or TBD, choose Count/Sq Ft, and Save quantity.
- Count requires a whole, non-negative number. Sq Ft permits up to four decimal
  places. Changing the unit does not automatically convert the number.
- The overview, room/category book views, shared/public views, printed output,
  and Excel export use the same quantity values. Excel has separate Qty/Unit
  columns so known quantities remain numeric and TBD remains explicit text.
- Save/validation errors leave the dialog and unsaved input intact. Cancel does
  not write. Existing edit permissions are retained; no client-editing pilot or
  saved-column-layout feature is enabled as part of this change.
- Procurement carries Sq Ft into its existing coverage/order-quantity workflow.
  TBD is missing quantity, never a ready order. Invoice drafts initially uncheck
  explicit TBD rows and require a known positive amount before those rows can be
  included in a saved/downloaded invoice or payment-link total. Legacy blank
  amounts retain their prior draft default of one. Confirm pricing per unit
  before invoicing area-based materials; no new automatic pricing conversion.
- Existing broader legacy material access policies are outside this change; the
  quantity guard does not claim to harden all other material fields.

## Checks

- Full suite: 265 passed, 2 skipped. Production build passed.
- 21 isolated PostgreSQL migration/default/validation/authorization checks passed
  using fictional data only, including old/new project assignment checks.
- Browser checks cover book/spreadsheet editing, decimal Sq Ft, whole Count,
  TBD, canceled edits, simulated failed saves, mobile layout and public read-only
  display. Production transaction smoke tests passed for authenticated staff
  decimal Sq Ft and TBD saves, anonymous/ordinary-client/unassigned-contractor/
  missing-profile rejection. All test writes were rolled back; the pre-existing
  explicitly allowed client editor remains allowed, as intended.
- Repository-wide TypeScript check remains blocked by pre-existing errors; no
  new error locations/codes were introduced by this change.

## Production preservation / backup coverage

- Managed-backup status could not be verified because the dashboard required a
  separate sign-in. No recurring backup configuration was changed.
- A restricted-permission, one-time snapshot of all 4,151 IDs/quantities and
  material schema metadata was saved locally before applying the migration:
  `/private/tmp/merav-quantity-pre-release-backup.json`. This is a scoped quantity
  recovery snapshot, not a full database or Storage backup.
- All 4,151 rows and 2,189 known quantities remained. All rows defaulted to Count;
  none were automatically marked TBD. One existing quantity changed from 1 to 2
  during concurrent use at 21:42:08 UTC, before migration 21:42:16 UTC; all other
  quantity values matched the snapshot. That concurrent change was preserved.
- Post-migration security-advisor categories/counts match the pre-release baseline.
  Existing broader access-policy findings remain outside this quantity release.
  See [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).
