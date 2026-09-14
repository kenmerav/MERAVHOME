import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  ContactRound,
  FileUp,
  Plus,
  Search,
  ShieldCheck,
  Store,
  X,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  parseVendorDirectoryCsv,
  type EaContact,
  type EaVendorProfile,
  type SafeVendorImportRow,
} from "@/lib/eaWorkspace";
import { loadEaWorkspace, saveEaWorkspace, type EaImportRow } from "@/lib/eaWorkspaceClient";
import { toast } from "sonner";

export const Route = createFileRoute("/people-vendors")({
  head: () => ({ meta: [{ title: "People & Vendors - MERAV Studio" }] }),
  beforeLoad: () => {
    throw redirect({ to: "/ea-desk" });
  },
  component: PeopleVendorsPage,
});

type Tab = "people" | "vendors" | "import";

function PeopleVendorsPage() {
  const [tab, setTab] = useState<Tab>("people");
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [routeFilter, setRouteFilter] = useState("all");
  const [contact, setContact] = useState<Partial<EaContact> | null>(null);
  const [vendor, setVendor] = useState<Partial<EaVendorProfile> | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["eaWorkspace"],
    queryFn: loadEaWorkspace,
  });
  const query = search.toLowerCase().trim();
  const contacts = useMemo(
    () =>
      (data?.contacts ?? []).filter(
        (item) =>
          (groupFilter === "all" || item.contact_kind === groupFilter) &&
          [item.name, item.company, item.general_role, item.email].some((value) =>
            String(value ?? "")
              .toLowerCase()
              .includes(query),
          ),
      ),
    [data?.contacts, groupFilter, query],
  );
  const vendors = useMemo(
    () =>
      (data?.vendors ?? []).filter(
        (item) =>
          (routeFilter === "all" || item.purchasing_route_status === routeFilter) &&
          [
            item.supplier_company,
            item.brand_or_manufacturer,
            ...(item.categories ?? []),
            ...(item.brands_supplied ?? []),
          ].some((value) =>
            String(value ?? "")
              .toLowerCase()
              .includes(query),
          ),
      ),
    [data?.vendors, query, routeFilter],
  );

  return (
    <AppShell>
      <div className="page-pad max-w-[1500px]">
        <header className="flex flex-col gap-5 border-b border-border pb-7 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="eyebrow mb-2">Internal directory</div>
            <h1 className="font-display text-5xl lg:text-6xl">People & Vendors</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              Project responsibilities and purchasing routes, with verification status and
              supporting sources.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-10 sm:w-72"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search people or suppliers"
              />
            </div>
            <button
              type="button"
              onClick={() => (tab === "vendors" ? setVendor({}) : setContact({}))}
              className="inline-flex items-center justify-center gap-2 bg-ink px-4 py-2.5 text-sm text-white"
            >
              <Plus className="h-4 w-4" /> Add {tab === "vendors" ? "vendor" : "person"}
            </button>
          </div>
        </header>
        {data?.setupNeeded && (
          <div className="mt-6 border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            Apply <code>20260909100000_add_ea_workspace.sql</code> to local Supabase before testing
            saved data.
          </div>
        )}
        {error && (
          <div className="mt-6 border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error instanceof Error ? error.message : "Unable to load the directory."}
          </div>
        )}

        <div className="mt-8 flex gap-1 overflow-x-auto border-b border-border">
          {(
            [
              ["people", `People (${data?.contacts.length ?? 0})`],
              ["vendors", `Vendors (${data?.vendors.length ?? 0})`],
              [
                "import",
                `Import review (${(data?.importRows ?? []).filter((row) => row.review_status === "needs_review" || row.review_status === "conflict").length})`,
              ],
            ] as Array<[Tab, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`border-b-2 px-4 py-3 text-xs uppercase tracking-[0.14em] ${tab === value ? "border-ink" : "border-transparent text-muted-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab !== "import" && (
          <div className="mt-5 flex flex-wrap gap-2">
            {tab === "people" ? (
              <select
                value={groupFilter}
                onChange={(event) => setGroupFilter(event.target.value)}
                className="h-10 border border-input bg-background px-3 text-sm"
              >
                <option value="all">All people</option>
                <option value="merav_team">MERAV team</option>
                <option value="client">Clients</option>
                <option value="builder_trade_consultant">Builders / trades / consultants</option>
                <option value="vendor_rep">Vendors / reps</option>
              </select>
            ) : (
              <select
                value={routeFilter}
                onChange={(event) => setRouteFilter(event.target.value)}
                className="h-10 border border-input bg-background px-3 text-sm"
              >
                <option value="all">All purchasing routes</option>
                <option value="confirmed">Confirmed</option>
                <option value="confirm_route">Confirm route</option>
                <option value="needs_verification">Needs verification</option>
                <option value="archived">Archived</option>
              </select>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="py-20 text-sm text-muted-foreground">Loading directory…</div>
        ) : tab === "people" ? (
          <PeopleList contacts={contacts} onEdit={setContact} />
        ) : tab === "vendors" ? (
          <VendorList vendors={vendors} onEdit={setVendor} />
        ) : (
          <ImportReview rows={data?.importRows ?? []} />
        )}
      </div>
      <ContactDialog value={contact} onClose={() => setContact(null)} />
      <VendorDialog
        value={vendor}
        contacts={data?.contacts ?? []}
        onClose={() => setVendor(null)}
      />
    </AppShell>
  );
}

function PeopleList({
  contacts,
  onEdit,
}: {
  contacts: EaContact[];
  onEdit: (contact: Partial<EaContact>) => void;
}) {
  if (!contacts.length)
    return (
      <Empty
        icon={ContactRound}
        title="No people found"
        text="Add verified contacts and connect them to project-specific responsibilities."
      />
    );
  return (
    <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {contacts.map((contact) => (
        <button
          key={contact.id}
          onClick={() => onEdit(contact)}
          className="border border-border bg-background p-5 text-left hover:border-ink"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl">{contact.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {[contact.general_role, contact.company].filter(Boolean).join(" · ") ||
                  "Role needs confirmation"}
              </p>
            </div>
            <Verification status={contact.verification_status} />
          </div>
          <div className="mt-5 space-y-1 text-sm">
            <p>{contact.email || "Email needs confirmation"}</p>
            <p>{contact.phone || "Phone needs confirmation"}</p>
          </div>
          {contact.source_reference && (
            <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
              Source: {contact.source_reference}
            </p>
          )}
        </button>
      ))}
    </div>
  );
}

function VendorList({
  vendors,
  onEdit,
}: {
  vendors: EaVendorProfile[];
  onEdit: (vendor: Partial<EaVendorProfile>) => void;
}) {
  if (!vendors.length)
    return (
      <Empty
        icon={Store}
        title="No purchasing routes found"
        text="Add the supplier MERAV actually purchases through—not only the product brand."
      />
    );
  return (
    <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {vendors.map((vendor) => (
        <button
          key={vendor.id}
          onClick={() => onEdit(vendor)}
          className="border border-border bg-background p-5 text-left hover:border-ink"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="eyebrow mb-1">Purchasing supplier</div>
              <h2 className="font-display text-2xl">{vendor.supplier_company}</h2>
            </div>
            <RouteStatus status={vendor.purchasing_route_status} />
          </div>
          {vendor.brand_or_manufacturer && (
            <p className="mt-3 text-sm">
              <span className="text-muted-foreground">Brand: </span>
              {vendor.brand_or_manufacturer}
            </p>
          )}
          <p className="mt-4 text-sm leading-6">
            {vendor.purchasing_instructions || "Purchasing instructions need verification."}
          </p>
          <div className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
            <p>Primary contact: {vendor.primary_sales_contact?.name || "Needs verification"}</p>
            <p className="mt-1">
              {vendor.categories?.join(", ") || "Categories need confirmation"}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}

function ContactDialog({
  value,
  onClose,
}: {
  value: Partial<EaContact> | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Partial<EaContact>>({});
  const [busy, setBusy] = useState(false);
  const current = value
    ? {
        contact_kind: "partner",
        name: "",
        company: "",
        general_role: "",
        email: "",
        phone: "",
        preferred_communication: "",
        internal_notes: "",
        verification_status: "needs_verification",
        source_reference: "",
        ...value,
        ...form,
      }
    : null;
  const set = (key: keyof EaContact, next: EaContact[keyof EaContact]) =>
    setForm((prior) => ({ ...prior, [key]: next }));
  const save = async () => {
    if (!current) return;
    setBusy(true);
    try {
      await saveEaWorkspace({ action: "save_contact", ...current });
      toast.success("Contact saved");
      await qc.invalidateQueries({ queryKey: ["eaWorkspace"] });
      setForm({});
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save contact.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={Boolean(value)}
      onOpenChange={(open) => {
        if (!open) {
          setForm({});
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="eyebrow mb-2">Directory contact</div>
          <DialogTitle className="font-display text-3xl">
            {value?.id ? "Edit person" : "Add person"}
          </DialogTitle>
        </DialogHeader>
        {current && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Name">
              <Input value={current.name ?? ""} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Group">
              <select
                value={current.contact_kind}
                onChange={(e) => set("contact_kind", e.target.value)}
                className="h-10 w-full border border-input bg-background px-3 text-sm"
              >
                <option value="merav_team">MERAV team</option>
                <option value="client">Client</option>
                <option value="builder_trade_consultant">Builder / trade / consultant</option>
                <option value="vendor_rep">Vendor / rep</option>
                <option value="partner">Other partner</option>
              </select>
            </Field>
            <Field label="Company">
              <Input
                value={current.company ?? ""}
                onChange={(e) => set("company", e.target.value)}
              />
            </Field>
            <Field label="General role">
              <Input
                value={current.general_role ?? ""}
                onChange={(e) => set("general_role", e.target.value)}
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={current.email ?? ""}
                onChange={(e) => set("email", e.target.value)}
              />
            </Field>
            <Field label="Phone">
              <Input value={current.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
            </Field>
            <Field label="Preferred communication">
              <Input
                value={current.preferred_communication ?? ""}
                onChange={(e) => set("preferred_communication", e.target.value)}
                placeholder="Email, call, text…"
              />
            </Field>
            <Field label="Verification">
              <select
                value={current.verification_status}
                onChange={(e) => set("verification_status", e.target.value)}
                className="h-10 w-full border border-input bg-background px-3 text-sm"
              >
                <option value="needs_verification">Needs verification</option>
                <option value="verified">Verified</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
            <Field label="Internal notes" className="md:col-span-2">
              <Textarea
                rows={3}
                value={current.internal_notes ?? ""}
                onChange={(e) => set("internal_notes", e.target.value)}
              />
            </Field>
            <Field label="Supporting source" className="md:col-span-2">
              <Input
                value={current.source_reference ?? ""}
                onChange={(e) => set("source_reference", e.target.value)}
                placeholder="Email, document, or confirmed conversation"
              />
            </Field>
          </div>
        )}
        <button
          disabled={busy}
          onClick={save}
          className="ml-auto bg-ink px-5 py-2.5 text-sm text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save person"}
        </button>
      </DialogContent>
    </Dialog>
  );
}

function VendorDialog({
  value,
  contacts,
  onClose,
}: {
  value: Partial<EaVendorProfile> | null;
  contacts: EaContact[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Partial<EaVendorProfile>>({});
  const [busy, setBusy] = useState(false);
  const current = value
    ? {
        supplier_company: "",
        brand_or_manufacturer: "",
        primary_sales_contact_id: "",
        service_contact_id: "",
        ordering_method: "",
        categories: [],
        brands_supplied: [],
        purchasing_instructions: "",
        purchasing_route_status: "needs_verification",
        contact_verification_status: "needs_verification",
        source_reference: "",
        ...value,
        ...form,
      }
    : null;
  const set = (key: keyof EaVendorProfile, next: EaVendorProfile[keyof EaVendorProfile]) =>
    setForm((prior) => ({ ...prior, [key]: next }));
  const save = async () => {
    if (!current) return;
    setBusy(true);
    try {
      await saveEaWorkspace({ action: "save_vendor", ...current });
      toast.success("Vendor route saved");
      await qc.invalidateQueries({ queryKey: ["eaWorkspace"] });
      setForm({});
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save vendor.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={Boolean(value)}
      onOpenChange={(open) => {
        if (!open) {
          setForm({});
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <div className="eyebrow mb-2">Purchasing route</div>
          <DialogTitle className="font-display text-3xl">
            {value?.id ? "Edit vendor" : "Add vendor"}
          </DialogTitle>
        </DialogHeader>
        {current && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Supplier company">
              <Input
                value={current.supplier_company ?? ""}
                onChange={(e) => set("supplier_company", e.target.value)}
              />
            </Field>
            <Field label="Brand / manufacturer">
              <Input
                value={current.brand_or_manufacturer ?? ""}
                onChange={(e) => set("brand_or_manufacturer", e.target.value)}
              />
            </Field>
            <Field label="Primary sales / quote contact">
              <PersonSelect
                value={current.primary_sales_contact_id ?? ""}
                contacts={contacts}
                onChange={(next) => set("primary_sales_contact_id", next)}
              />
            </Field>
            <Field label="Delivery / damage contact">
              <PersonSelect
                value={current.service_contact_id ?? ""}
                contacts={contacts}
                onChange={(next) => set("service_contact_id", next)}
              />
            </Field>
            <Field label="Categories">
              <Input
                value={
                  Array.isArray(current.categories)
                    ? current.categories.join(", ")
                    : current.categories
                }
                onChange={(e) => set("categories", e.target.value)}
                placeholder="Lighting, furniture"
              />
            </Field>
            <Field label="Brands supplied">
              <Input
                value={
                  Array.isArray(current.brands_supplied)
                    ? current.brands_supplied.join(", ")
                    : current.brands_supplied
                }
                onChange={(e) => set("brands_supplied", e.target.value)}
              />
            </Field>
            <Field label="Ordering method" className="md:col-span-2">
              <Input
                value={current.ordering_method ?? ""}
                onChange={(e) => set("ordering_method", e.target.value)}
                placeholder="Rep quote, trade portal, email draft…"
              />
            </Field>
            <Field label="Purchasing instructions" className="md:col-span-2">
              <Textarea
                rows={4}
                value={current.purchasing_instructions ?? ""}
                onChange={(e) => set("purchasing_instructions", e.target.value)}
              />
            </Field>
            <Field label="Purchasing route">
              <select
                value={current.purchasing_route_status}
                onChange={(e) => set("purchasing_route_status", e.target.value)}
                className="h-10 w-full border border-input bg-background px-3 text-sm"
              >
                <option value="confirmed">Confirmed</option>
                <option value="confirm_route">Confirm purchasing route</option>
                <option value="needs_verification">Needs verification</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
            <Field label="Contact status">
              <select
                value={current.contact_verification_status}
                onChange={(e) => set("contact_verification_status", e.target.value)}
                className="h-10 w-full border border-input bg-background px-3 text-sm"
              >
                <option value="verified">Verified</option>
                <option value="needs_verification">Needs verification</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
            <Field label="Supporting source" className="md:col-span-2">
              <Input
                value={current.source_reference ?? ""}
                onChange={(e) => set("source_reference", e.target.value)}
              />
            </Field>
          </div>
        )}
        <button
          disabled={busy}
          onClick={save}
          className="ml-auto bg-ink px-5 py-2.5 text-sm text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save vendor"}
        </button>
      </DialogContent>
    </Dialog>
  );
}

function ImportReview({ rows }: { rows: EaImportRow[] }) {
  const qc = useQueryClient();
  const [preview, setPreview] = useState<SafeVendorImportRow[]>([]);
  const [busy, setBusy] = useState(false);
  const loadFile = async (file?: File) => {
    if (!file) return;
    const parsed = parseVendorDirectoryCsv(await file.text());
    setPreview(parsed);
    if (!parsed.length) toast.error("No safe vendor rows were found in this CSV.");
  };
  const stage = async () => {
    if (!preview.length) return;
    setBusy(true);
    try {
      const result = await saveEaWorkspace({ action: "preview_import", rows: preview });
      toast.success(`${result.importRows?.length ?? preview.length} rows staged for review`);
      setPreview([]);
      await qc.invalidateQueries({ queryKey: ["eaWorkspace"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to stage import.");
    } finally {
      setBusy(false);
    }
  };
  const decide = async (id: string, decision: "approved" | "skipped") => {
    try {
      await saveEaWorkspace({ action: "review_import", id, decision });
      toast.success(decision === "approved" ? "Vendor approved" : "Row skipped");
      await qc.invalidateQueries({ queryKey: ["eaWorkspace"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to review row.");
    }
  };
  const pending = rows.filter(
    (row) => row.review_status === "needs_review" || row.review_status === "conflict",
  );
  return (
    <div className="mt-6 space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="border border-border p-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-1 h-5 w-5" />
            <div>
              <h2 className="font-display text-2xl">Safe, one-time import</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Export only the Vendor Directory tab as CSV. Studio reads vendor name, category, rep
                name, and valid rep email. Account logins, passwords, notes, discounts, and every
                unknown column are discarded in the browser and never sent to the server.
              </p>
              <a
                href="https://docs.google.com/spreadsheets/d/15m_YO1zSbxuJcacuXKaY6HB81dTlmY79kMCESH1y_ms/edit?gid=0#gid=0"
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block text-xs underline underline-offset-4"
              >
                Open read-only reference sheet
              </a>
            </div>
          </div>
          <label className="mt-5 flex cursor-pointer items-center justify-center gap-2 border border-dashed border-border px-4 py-8 text-sm hover:border-ink">
            <FileUp className="h-4 w-4" /> Choose Vendor Directory CSV
            <input
              className="hidden"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => loadFile(e.target.files?.[0])}
            />
          </label>
        </div>
        <div className="border border-border bg-bone/20 p-5">
          <div className="eyebrow mb-2">Preview</div>
          <div className="font-display text-4xl">{preview.length}</div>
          <p className="mt-1 text-sm text-muted-foreground">safe rows ready to stage</p>
          {preview.length > 0 && (
            <>
              <div className="mt-4 max-h-36 space-y-1 overflow-auto text-xs">
                {preview.slice(0, 12).map((row) => (
                  <div key={row.source_row_number} className="flex justify-between gap-3">
                    <span>{row.vendor}</span>
                    <span className="text-muted-foreground">row {row.source_row_number}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={stage}
                disabled={busy}
                className="mt-4 w-full bg-ink px-4 py-2.5 text-sm text-white"
              >
                {busy ? "Staging…" : "Stage review rows"}
              </button>
            </>
          )}
        </div>
      </div>
      {pending.length === 0 ? (
        <Empty
          icon={ShieldCheck}
          title="No rows awaiting review"
          text="Imported records appear here before they become maintained Studio directory entries."
        />
      ) : (
        <div className="space-y-3">
          <div>
            <div className="eyebrow mb-2">Review queue</div>
            <h2 className="font-display text-3xl">Confirm before adding</h2>
          </div>
          {pending.map((row) => (
            <div
              key={row.id}
              className={`grid grid-cols-1 gap-4 border p-4 md:grid-cols-[1fr_auto] md:items-center ${row.review_status === "conflict" ? "border-amber-300 bg-amber-50" : "border-border"}`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">{row.safe_payload.vendor}</h3>
                  {row.review_status === "conflict" && (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-800">
                      <AlertTriangle className="h-3 w-3" /> Possible duplicate
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {[
                    row.safe_payload.category,
                    row.safe_payload.rep_name,
                    row.safe_payload.rep_email,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "No rep details"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Source row {row.source_row_number}
                  {row.review_notes ? ` · ${row.review_notes}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => decide(row.id, "skipped")}
                  className="inline-flex items-center gap-1 border border-border px-3 py-2 text-xs"
                >
                  <X className="h-3 w-3" /> Skip
                </button>
                <button
                  onClick={() => decide(row.id, "approved")}
                  className="inline-flex items-center gap-1 bg-ink px-3 py-2 text-xs text-white"
                >
                  <Check className="h-3 w-3" /> Approve
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PersonSelect({
  value,
  contacts,
  onChange,
}: {
  value: string;
  contacts: EaContact[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full border border-input bg-background px-3 text-sm"
    >
      <option value="">Needs verification</option>
      {contacts.map((contact) => (
        <option key={contact.id} value={contact.id}>
          {contact.name}
          {contact.company ? ` · ${contact.company}` : ""}
        </option>
      ))}
    </select>
  );
}
function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="eyebrow">{label}</Label>
      {children}
    </div>
  );
}
function Empty({ icon: Icon, title, text }: { icon: typeof Store; title: string; text: string }) {
  return (
    <div className="mt-6 border border-dashed border-border py-16 text-center">
      <Icon className="mx-auto h-6 w-6 text-muted-foreground" />
      <h2 className="mt-3 font-display text-2xl">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
function Verification({ status }: { status: string }) {
  return (
    <span
      className={`shrink-0 px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${status === "verified" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}
    >
      {status === "verified"
        ? "Verified"
        : status === "archived"
          ? "Archived"
          : "Needs verification"}
    </span>
  );
}
function RouteStatus({ status }: { status: string }) {
  return (
    <span
      className={`shrink-0 px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${status === "confirmed" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}
    >
      {status === "confirmed"
        ? "Confirmed"
        : status === "confirm_route"
          ? "Confirm route"
          : status === "archived"
            ? "Archived"
            : "Needs verification"}
    </span>
  );
}
