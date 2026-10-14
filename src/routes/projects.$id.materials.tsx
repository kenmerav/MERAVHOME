import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  Pencil,
  Search,
  AlertTriangle,
  ChevronUp,
  ScanSearch,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { MaterialPhotoUpload } from "@/components/MaterialPhotoUpload";
import { SpecCompletionReview } from "@/components/SpecCompletionReview";
import { MaterialDetailsEditor } from "@/components/MaterialDetailsEditor";
import { MaterialCatalogSuggestions } from "@/components/MaterialCatalogSuggestions";
import { saveAndScrapeMaterialLink } from "@/lib/materialProductLink";
import { refreshCatalogSelectionIfNeeded } from "@/lib/catalogProductRefresh";
import { formatPriceWithUnit, materialPriceUnit, inferProductPriceUnit } from "@/lib/productPriceUnit";
import { ImportSelectionSheetDialog } from "@/components/ImportSelectionSheetDialog";
import { db, type MaterialItem, type Product, type Room } from "@/lib/db";
import { SpecQuantityEditor } from "@/components/SpecQuantityEditor";
import {
  ALL_CATEGORIES,
  PRODUCT_CATEGORIES,
  inferMaterialCategory,
  normalizeItemCategory,
  templateForRoomName,
  toProductCategory,
} from "@/lib/roomTemplates";
import { buildClientProductName, clientProductName } from "@/lib/clientProductName";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cleanUuid, isUuid } from "@/lib/ids";
import { normalizeSupabaseImageUrl } from "@/lib/local-assets";
import { materialHasUserSelection } from "@/lib/materialSelection";
import { materialCoversTemplateSuggestion, normalizeMaterialSuggestionLabel, suggestedTemplatesForRoom, confirmedNoShower, type BathroomPlanEvidence } from "@/lib/materialSuggestions";
import { fetchMaterialPlanCheck } from "@/lib/materialPlanCheck";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/projects/$id/materials")({
  head: () => ({ meta: [{ title: "Materials — MERAV Studio" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    itemId: cleanUuid(search.itemId) ?? undefined,
    roomId: cleanUuid(search.roomId) ?? undefined,
  }),
  component: MaterialsPage,
});

const DIRECT_PDF_UPLOAD_LIMIT = 4 * 1024 * 1024;
const MATERIALS_TOP_ID = "materials-page-top";
const ORDERED_BY_OPTIONS = ["Contractor", "Merav", "Client"] as const;

function roomSectionId(roomId: string) {
  return `materials-room-${roomId}`;
}

function materialRowId(itemId: string) {
  return `materials-item-${itemId}`;
}

function isNeedsReselection(item: MaterialItem) {
  return item.room_product?.approval_status === "declined";
}

function NeedsReselectionBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] font-medium tracking-wide text-red-800">
      <AlertTriangle className="h-3 w-3" />
      Needs re-selection
    </span>
  );
}

function currentFinishCheck(item: MaterialItem) {
  const values = [item.color?.trim(), item.product?.finish?.trim()].filter(
    (value): value is string => Boolean(value),
  );
  const productFinish = Array.from(new Set(values.map((value) => value.toLowerCase())))
    .map((value) => values.find((candidate) => candidate.toLowerCase() === value)!)
    .join(" / ");

  if (
    !item.finish_check_status ||
    item.finish_check_status === "unchecked" ||
    item.finish_check_image_url !== item.image_url ||
    item.finish_check_product_finish !== productFinish
  ) {
    return null;
  }
  return item.finish_check_status;
}

function FinishCheckBadge({ item }: { item: MaterialItem }) {
  const status = currentFinishCheck(item);
  if (!status) return null;

  if (status === "possible_mismatch") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-[10px] font-medium tracking-wide text-amber-900"
        title={item.finish_check_reason || "Review the product finish against the board image."}
      >
        <AlertTriangle className="h-3 w-3" />
        Possible finish mismatch
      </span>
    );
  }

  if (status === "uncertain") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground"
        title={item.finish_check_reason || "The image was not clear enough to verify the finish."}
      >
        Finish unclear
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium tracking-wide text-emerald-800">
      Finish checked
    </span>
  );
}

function FinishCheckDetails({ item }: { item: MaterialItem }) {
  const status = currentFinishCheck(item);
  if (status !== "possible_mismatch") return null;

  return (
    <div className="mt-2 border-l-2 border-amber-400 pl-2 text-[10px] leading-4 text-amber-900">
      <div>
        Product: {item.finish_check_product_finish || "Unclear"} · Image appears:{" "}
        {item.finish_check_image_finish || "Unclear"}
      </div>
      {item.finish_check_reason && <div className="text-amber-800">{item.finish_check_reason}</div>}
    </div>
  );
}

type ScrapedRow = {
  material_item_id: string;
  url: string;
  existing_product_id?: string | null;
  scraped: {
    name?: string;
    vendor?: string;
    image_url?: string;
    color?: string;
    finish?: string;
    sku?: string;
    dimensions?: string;
    price?: string;
    unit_cost?: string;
    shipping?: string;
    carton_coverage_sq_ft?: number;
    carton_coverage_source_url?: string;
    carton_coverage_source_text?: string;
    carton_coverage_confidence?: "exact" | "review" | "missing";
    error?: string;
  };
};

async function readApiJson<T = any>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    const message = text.replace(/\s+/g, " ").trim().slice(0, 180);
    throw new Error(message || `Request failed (${res.status})`);
  }
}

function productCategoryPatchForMaterialCategory(category: string): Partial<Product> {
  const normalized = normalizeItemCategory(category) ?? "Other";
  const productCategory = toProductCategory(normalized);
  const patch: Partial<Product> = { category: productCategory };

  // Product Catalog has a stricter category enum, so keep the studio-specific
  // category on subcategory when the enum has to collapse it to Decor/Hardware.
  if (productCategory === "Decor" || productCategory === "Hardware") {
    patch.subcategory = normalized;
  } else if (normalized === "Tile & Stone") {
    patch.subcategory = "Tile";
  }

  return patch;
}

function formatLastUpdated(value: string | null | undefined) {
  if (!value) return "Not updated yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not updated yet";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function latestTimestamp(values: Array<string | null | undefined>) {
  let latest = 0;
  let latestValue: string | null = null;
  for (const value of values) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (!Number.isNaN(time) && time > latest) {
      latest = time;
      latestValue = value;
    }
  }
  return latestValue;
}

function isUntouchedTemplatePlaceholder(item: MaterialItem) {
  return item.is_required && !item.not_needed && !materialHasUserSelection(item);
}

type MaterialSuggestion = {
  key: string;
  label: string;
  category: string;
  existingItem: MaterialItem | null;
};

function MaterialsPage() {
  const { id } = Route.useParams();
  const { itemId: reviewItemId, roomId: reviewRoomId } = Route.useSearch();
  const projectId = cleanUuid(id);
  const qc = useQueryClient();

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => db.getProject(projectId!),
    enabled: !!projectId,
  });
  const { data: profile, isLoading: loadingProfile } = useQuery({
    queryKey: ["currentUserProfile"],
    queryFn: () => db.getCurrentUserProfile(),
  });
  const { data: rooms = [], isSuccess: roomsLoaded } = useQuery({
    queryKey: ["rooms", projectId],
    queryFn: async () => (await db.listRooms(projectId!)) ?? [],
    enabled: !!projectId,
  });
  const { data: items = [], isSuccess: itemsLoaded } = useQuery({
    queryKey: ["materialItems", projectId],
    queryFn: async () => (await db.listMaterialItemsByProject(projectId!)) ?? [],
    enabled: !!projectId,
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await db.listCatalog()) ?? [],
  });

  const [scraping, setScraping] = useState(false);
  const [scrapeStatus, setScrapeStatus] = useState("");
  const [checkingFinishes, setCheckingFinishes] = useState(false);
  const [finishCheckStatus, setFinishCheckStatus] = useState("");
  const [importingPdf, setImportingPdf] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);

  const canManageMaterials =
    profile?.is_active === true && (profile.role === "Admin" || profile.role === "Employee");
  const [reviewPlans, setReviewPlans] = useState(false);
  const documentsQuery = useQuery({
    queryKey: ["projectDocuments", projectId, profile?.id, "history"],
    queryFn: async () => (await db.listProjectDocuments(projectId!)) ?? [],
    enabled: !!projectId && canManageMaterials,
  });
  const latestPlan = documentsQuery.data?.find(document => document.document_type === "Construction Doc" && !document.superseded_by_document_id);
  const planQuery = useQuery({
    queryKey: ["materialPlanCheck", projectId, latestPlan?.id, latestPlan?.updated_at,
      rooms.filter(room => /bath|powder/i.test(room.name)).map(room => `${room.id}:${room.name}`).sort().join("|")],
    queryFn: async () => {
      try { return await fetchMaterialPlanCheck(projectId!, latestPlan!.id); }
      catch (error) {
        if ((error as Error & { status?: number }).status === 409)
          await qc.invalidateQueries({ queryKey: ["projectDocuments", projectId] });
        throw error;
      }
    },
    enabled: reviewPlans && !!latestPlan && canManageMaterials && rooms.length > 0,
    staleTime: 24 * 60 * 60 * 1000, retry: false,
    refetchOnWindowFocus: false,
  });
  const planStatus = !reviewPlans ? "idle" : documentsQuery.isError ? "error" :
    documentsQuery.isPending ? "checking" : !latestPlan ? "no_document" :
    planQuery.isError || planQuery.data?.status === "unavailable" ? "error" :
    planQuery.isPending ? "checking" : "checked";

  const byRoom = useMemo(() => {
    const map = new Map<string, MaterialItem[]>();
    items.forEach((it) => {
      const arr = map.get(it.room_id) ?? [];
      arr.push(it);
      map.set(it.room_id, arr);
    });
    return map;
  }, [items]);

  const sortedRooms = useMemo(
    () =>
      [...rooms].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    [rooms],
  );
  const [jumpRoomId, setJumpRoomId] = useState<string>("");
  const focusedReviewRoom = useRef<string | null>(null);
  const reviewItem = items.find(item => item.id === reviewItemId);
  const reviewItemVisible = reviewItem && !reviewItem.not_needed && !isUntouchedTemplatePlaceholder(reviewItem) && rooms.some(room => room.id === reviewItem.room_id);

  useEffect(() => {
    if (reviewItemVisible) setJumpRoomId(reviewItem.room_id);
  }, [reviewItemId, reviewItemVisible, reviewItem?.room_id]);

  useEffect(() => {
    if (reviewItemId || !reviewRoomId || focusedReviewRoom.current === reviewRoomId || !itemsLoaded || !roomsLoaded || !project || !canManageMaterials) return;
    const section = document.getElementById(roomSectionId(reviewRoomId));
    if (!section) return;
    const frame = requestAnimationFrame(() => {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
      setJumpRoomId(reviewRoomId);
      focusedReviewRoom.current = reviewRoomId;
    });
    return () => cancelAnimationFrame(frame);
  }, [reviewItemId, reviewRoomId, itemsLoaded, roomsLoaded, project, canManageMaterials]);

  const scrollToTop = () => {
    setJumpRoomId("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const jumpToRoom = (roomId: string) => {
    setJumpRoomId(roomId);
    document.getElementById(roomSectionId(roomId))?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const overall = useMemo(() => {
    const activeItems = items.filter(
      (item) => !item.not_needed && !isUntouchedTemplatePlaceholder(item),
    );
    const total = activeItems.length;
    const done = activeItems.filter(
      (it) => it.product_url && it.product_url.trim().length > 0,
    ).length;
    return { done, total };
  }, [items]);
  const lastUpdatedAt = useMemo(
    () =>
      latestTimestamp([
        project?.updated_at,
        ...rooms.map((room) => room.updated_at),
        ...items.flatMap((item) => [item.updated_at, item.product?.updated_at]),
      ]),
    [items, project?.updated_at, rooms],
  );

  const saveScrapedRows = async (rows: ScrapedRow[], announce = true) => {
    const successfulRows = rows.filter((row) => !row.scraped.error);
    const failedCount = rows.length - successfulRows.length;
    let priceMissingCount = 0;

    if (successfulRows.length > 0) {
      setScrapeStatus(
        `Saving ${successfulRows.length} product${successfulRows.length === 1 ? "" : "s"}...`,
      );
      const safeRows = successfulRows
        .map((row) => ({
          ...row,
          material_item_id: cleanUuid(row.material_item_id) ?? "",
          existing_product_id: cleanUuid(row.existing_product_id),
        }))
        .filter((row) => row.material_item_id);
      const res = await fetch("/api/scrape-materials", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token || ""}` },
        body: JSON.stringify({ project_id: projectId, rows: safeRows }),
      });
      const body = await readApiJson<{ error?: string; price_missing_count?: number }>(res);
      if (!res.ok) throw new Error(body?.error || "Could not save scraped products");
      priceMissingCount = body?.price_missing_count ?? 0;
      if (announce) {
        toast.success(
          `Saved ${safeRows.length} product${safeRows.length === 1 ? "" : "s"} to catalog`,
        );
      }
      qc.invalidateQueries({ queryKey: ["materialItems", projectId] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["procurement"] });
    }

    if (announce && failedCount > 0) {
      toast.warning(
        `${failedCount} item${failedCount === 1 ? " was" : "s were"} left unchanged because product details could not be scraped.`,
      );
    }
    return priceMissingCount;
  };

  const runScrape = async () => {
    if (!projectId) return toast.error("Invalid project link.");
    setScraping(true);
    setScrapeStatus("Starting scrape...");
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session) throw new Error("Sign in to scrape product info.");
      const scrapeHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` };
      const collectedRows: ScrapedRow[] = [];
      const collectedIds = new Set<string>();
      let invalidLinkCount = 0;
      let alreadyScrapedCount = 0;
      let remainingCount = 0;
      let batchCount = 0;
      let priceMissingCount = 0;

      while (true) {
        setScrapeStatus(
          collectedRows.length > 0
            ? `Scraping... ${collectedRows.length} found`
            : "Finding product details...",
        );
        const res = await fetch("/api/scrape-materials", {
          method: "POST",
          headers: scrapeHeaders,
          body: JSON.stringify({
            action: "start",
            project_id: projectId,
            exclude_material_item_ids: Array.from(collectedIds),
          }),
        });
        const body = await readApiJson<{
          status?: "started" | "processing" | "completed" | "failed";
          batch_id?: string;
          candidates?: Array<{
            material_item_id?: string;
            url?: string;
            existing_product_id?: string | null;
          }>;
          prefetched_rows?: ScrapedRow[];
          rows?: ScrapedRow[];
          completed_count?: number;
          total_count?: number;
          invalid_link_count?: number;
          already_scraped_count?: number;
          remaining_count?: number;
          error?: string;
        }>(res);
        if (!res.ok) throw new Error(body?.error || "Scrape failed");

        let completedBody = body;
        if (body?.status === "started") {
          if (!body.batch_id || !body.candidates?.length)
            throw new Error("Scrape batch did not start correctly.");
          let pollCount = 0;
          while (true) {
            await new Promise((resolve) => window.setTimeout(resolve, 1200));
            setScrapeStatus(`Scraping batch ${batchCount + 1}...`);
            pollCount += 1;
            if (pollCount >= 100) {
              setScrapeStatus(`Finishing batch ${batchCount + 1} one product at a time...`);
              const fallbackRes = await fetch("/api/scrape-materials", {
                method: "POST",
                headers: scrapeHeaders,
                body: JSON.stringify({
                  action: "fallback",
                  project_id: projectId,
                  candidates: body.candidates,
                }),
              });
              const fallbackBody = await readApiJson<typeof body>(fallbackRes);
              if (!fallbackRes.ok) throw new Error(fallbackBody?.error || "Scrape fallback failed");
              completedBody = {
                ...body,
                ...fallbackBody,
                rows: [...(body.prefetched_rows ?? []), ...(fallbackBody?.rows ?? [])],
              };
              break;
            }
            const pollRes = await fetch("/api/scrape-materials", {
              method: "POST",
              headers: scrapeHeaders,
              body: JSON.stringify({
                action: "poll",
                project_id: projectId,
                batch_id: body.batch_id,
                candidates: body.candidates,
              }),
            });
            const pollBody = await readApiJson<typeof body>(pollRes);
            if (!pollRes.ok) throw new Error(pollBody?.error || "Scrape batch failed");
            if (pollBody?.status === "processing") {
              const completed = pollBody.completed_count ?? 0;
              const total = pollBody.total_count ?? body.candidates.length;
              setScrapeStatus(
                completed > 0
                  ? `Scraping batch ${batchCount + 1} (${completed} of ${total})...`
                  : `Scraping batch ${batchCount + 1}...`,
              );
              continue;
            }
            completedBody = {
              ...body,
              ...pollBody,
              rows: [...(body.prefetched_rows ?? []), ...(pollBody?.rows ?? [])],
            };
            break;
          }
        }

        const rows = (completedBody?.rows ?? []) as ScrapedRow[];
        invalidLinkCount = completedBody?.invalid_link_count ?? invalidLinkCount;
        alreadyScrapedCount = completedBody?.already_scraped_count ?? alreadyScrapedCount;
        remainingCount = completedBody?.remaining_count ?? 0;

        rows.forEach((row) => {
          if (collectedIds.has(row.material_item_id)) return;
          collectedIds.add(row.material_item_id);
          collectedRows.push(row);
        });

        if (rows.length > 0) {
          priceMissingCount += await saveScrapedRows(rows, false);
        }

        batchCount += 1;
        if (rows.length === 0 || remainingCount === 0) break;
        if (batchCount > 100) {
          throw new Error("Scrape stopped after 100 batches. Run it again to continue.");
        }
      }

      const rows = collectedRows;
      if (rows.length === 0) {
        const parts = [
          alreadyScrapedCount > 0
            ? `${alreadyScrapedCount} item${alreadyScrapedCount === 1 ? "" : "s"} already checked or complete`
            : "",
          invalidLinkCount > 0
            ? `${invalidLinkCount} item${invalidLinkCount === 1 ? "" : "s"} without a valid link`
            : "",
        ].filter(Boolean);
        toast.info(
          parts.length
            ? `Nothing new to scrape. Skipped ${parts.join(" and ")}.`
            : "Nothing new to scrape.",
        );
      } else {
        const failedCount = rows.filter((row) => row.scraped.error).length;
        const savedCount = rows.length - failedCount;
        if (savedCount > 0) {
          toast.success(
            `Saved ${savedCount} product${savedCount === 1 ? "" : "s"}. ${savedCount - priceMissingCount} with prices.`,
          );
        }
        if (priceMissingCount > 0) {
          toast.warning(
            `${priceMissingCount} item${priceMissingCount === 1 ? " still needs" : "s still need"} an exact price. Review the flagged rows for variant ranges or missing prices.`,
          );
        }
        if (failedCount > 0) {
          toast.warning(
            `${failedCount} item${failedCount === 1 ? " still needs" : "s still need"} product details.`,
          );
        }
      }
    } catch (e: any) {
      toast.error(e?.message || "Scrape failed");
    } finally {
      setScrapeStatus("");
      setScraping(false);
    }
  };

  const runFinishCheck = async () => {
    if (!projectId) return toast.error("Invalid project link.");
    setCheckingFinishes(true);
    setFinishCheckStatus("Finding finishes...");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in again to check finishes.");

      const processedIds = new Set<string>();
      let checkedCount = 0;
      let mismatchCount = 0;
      let uncertainCount = 0;
      let failedCount = 0;
      let batchCount = 0;

      while (true) {
        setFinishCheckStatus(
          checkedCount > 0
            ? `Checking finishes... ${checkedCount} complete`
            : "Checking finishes...",
        );
        const res = await fetch("/api/check-material-finishes", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            project_id: projectId,
            exclude_material_item_ids: Array.from(processedIds),
          }),
        });
        const body = await readApiJson<{
          rows?: Array<{
            material_item_id: string;
            status: "match" | "possible_mismatch" | "uncertain" | "error";
          }>;
          remaining_count?: number;
          error?: string;
        }>(res);
        if (!res.ok) throw new Error(body.error || "Finish check failed.");

        const rows = body.rows ?? [];
        rows.forEach((row) => {
          processedIds.add(row.material_item_id);
          checkedCount += 1;
          if (row.status === "possible_mismatch") mismatchCount += 1;
          if (row.status === "uncertain") uncertainCount += 1;
          if (row.status === "error") failedCount += 1;
        });
        await qc.invalidateQueries({ queryKey: ["materialItems", projectId] });

        batchCount += 1;
        if (rows.length === 0 || (body.remaining_count ?? 0) === 0) break;
        if (batchCount >= 100) throw new Error("Finish check paused after 100 batches.");
      }

      if (checkedCount === 0) {
        toast.info("All eligible board images and product finishes are already checked.");
      } else if (mismatchCount > 0) {
        toast.warning(
          `Checked ${checkedCount} item${checkedCount === 1 ? "" : "s"}. Review ${mismatchCount} possible finish mismatch${mismatchCount === 1 ? "" : "es"}.${failedCount > 0 ? ` ${failedCount} could not be checked and can be retried.` : ""}`,
        );
      } else if (failedCount > 0) {
        toast.warning(
          `${checkedCount - failedCount} finish${checkedCount - failedCount === 1 ? " was" : "es were"} checked. ${failedCount} item${failedCount === 1 ? "" : "s"} could not be checked and can be retried.`,
        );
      } else {
        toast.success(
          `Checked ${checkedCount} item${checkedCount === 1 ? "" : "s"}.${uncertainCount > 0 ? ` ${uncertainCount} could not be confirmed from the image.` : " No finish mismatches found."}`,
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Finish check failed.");
    } finally {
      setCheckingFinishes(false);
      setFinishCheckStatus("");
    }
  };

  const importPdf = async (file: File | null | undefined) => {
    if (!file) return;
    if (!projectId) return toast.error("Invalid project link.");
    setImportingPdf(true);
    try {
      const res =
        file.size > DIRECT_PDF_UPLOAD_LIMIT
          ? await importLargePdf(projectId, file)
          : await fetch("/api/import-materials-pdf", {
              method: "POST",
              body: pdfImportFormData(projectId!, file),
            });
      const body = await readJsonResponse(res);
      if (!res.ok) throw new Error(body?.error || "PDF import failed");
      toast.success(
        `Imported ${body.imported ?? 0} linked item${body.imported === 1 ? "" : "s"} from ${body.room_names?.join(", ") || "PDF"}`,
      );
      qc.invalidateQueries({ queryKey: ["rooms", projectId] });
      qc.invalidateQueries({ queryKey: ["materialItems", projectId] });
    } catch (e: any) {
      toast.error(e?.message || "PDF import failed");
    } finally {
      setImportingPdf(false);
      if (pdfInputRef.current) pdfInputRef.current.value = "";
    }
  };

  if (!projectId)
    return (
      <AppShell>
        <div className="p-16 text-muted-foreground">Invalid project link.</div>
      </AppShell>
    );
  if (loadingProfile)
    return (
      <AppShell>
        <div className="p-16 text-muted-foreground">Loading materials...</div>
      </AppShell>
    );
  if (!canManageMaterials) {
    return (
      <AppShell>
        <div className="page-pad max-w-3xl">
          <Link
            to="/projects/$id"
            params={{ id: projectId }}
            className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" /> Back to project
          </Link>
          <h1 className="editorial-hero text-5xl">Materials</h1>
          <p className="mt-4 text-muted-foreground">
            Materials editing is available to MERAV team members only.
          </p>
        </div>
      </AppShell>
    );
  }
  if (!project)
    return (
      <AppShell>
        <div className="p-16 text-muted-foreground">Loading…</div>
      </AppShell>
    );

  return (
    <AppShell>
      <div id={MATERIALS_TOP_ID} className="page-pad max-w-[1500px]">
        <Link
          to="/projects/$id"
          params={{ id: projectId }}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-ink mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Project
        </Link>

        <div className="flex items-end justify-between flex-wrap gap-6 mb-10">
          <div>
            <div className="eyebrow mb-2">
              {project.name} · {project.client_name}
            </div>
            <h1 className="editorial-hero text-4xl lg:text-6xl">Materials</h1>
            <div className="mt-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Last updated {formatLastUpdated(lastUpdatedAt)}
            </div>
            <p className="text-sm text-muted-foreground mt-3 max-w-xl">
              Only materials you have chosen appear below. Use each room&apos;s possible-item review
              to add anything that may still be needed, then fill in its link, quantity, finish, and
              other details.
            </p>
          </div>
          <div className="flex flex-col items-end gap-3">
            <div className="text-xs text-muted-foreground">
              {overall.done} of {overall.total} items complete
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <RoomJumpSelect
                rooms={sortedRooms}
                value={jumpRoomId}
                onJump={jumpToRoom}
                className="min-w-[220px]"
              />
              {canManageMaterials && <SpecCompletionReview projectId={projectId} items={items} rooms={rooms} />}
              <ImportSelectionSheetDialog
                projectId={projectId}
                rooms={rooms}
                disabled={importingPdf || checkingFinishes || scraping}
                onImport={() => {
                  qc.invalidateQueries({ queryKey: ["rooms", projectId] });
                  qc.invalidateQueries({ queryKey: ["materialItems", projectId] });
                  qc.invalidateQueries({ queryKey: ["products"] });
                  qc.invalidateQueries({ queryKey: ["catalog"] });
                  qc.invalidateQueries({ queryKey: ["procurement"] });
                }}
              />
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(event) => importPdf(event.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => pdfInputRef.current?.click()}
                disabled={importingPdf || checkingFinishes}
                className="inline-flex items-center gap-2 px-5 py-3 border border-ink text-ink text-sm tracking-wide disabled:opacity-60"
              >
                <Upload className="w-4 h-4" />
                {importingPdf ? "Importing..." : "Import PDF"}
              </button>
              <button
                type="button"
                onClick={runFinishCheck}
                disabled={checkingFinishes || scraping}
                className="inline-flex items-center gap-2 border border-ink px-5 py-3 text-sm tracking-wide text-ink disabled:opacity-60"
                title="Compare each material's design-board image with its product finish"
              >
                <ScanSearch className="h-4 w-4" />
                {checkingFinishes ? finishCheckStatus || "Checking..." : "Check Finishes"}
              </button>
              <button
                onClick={runScrape}
                disabled={scraping || checkingFinishes}
                className="inline-flex items-center gap-2 px-5 py-3 bg-ink text-primary-foreground text-sm tracking-wide disabled:opacity-60"
              >
                <Sparkles className="w-4 h-4" />
                {scraping ? scrapeStatus || "Scraping..." : "Scrape Product Info"}
              </button>
            </div>
          </div>
        </div>

        {reviewItemId && itemsLoaded && roomsLoaded && !reviewItemVisible && <p role="status" className="mb-6 border border-amber-200 bg-amber-50 px-4 py-3 text-sm">This review item is no longer an active material in this project. Review the current selections below.</p>}
        <div className="space-y-12">
          {sortedRooms.map((room) => (
            <RoomMaterialsSection
              key={room.id}
              room={room}
              items={byRoom.get(room.id) ?? []}
              products={products}
              projectId={projectId}
              reviewItemId={reviewItemVisible && reviewItem.room_id === room.id ? reviewItemId : undefined}
              planEvidence={planQuery.data?.document?.id === latestPlan?.id
                ? planQuery.data?.rooms.find(evidence => evidence.room_id === room.id) : undefined}
              planTitle={planQuery.data?.document?.title ?? ""}
              planStatus={planStatus}
              planMessage={planQuery.data?.message}
              onReviewPlans={() => { if (/bath|powder/i.test(room.name)) setReviewPlans(true); }}
            />
          ))}
        </div>

        {sortedRooms.length > 0 && (
          <div className="fixed bottom-5 right-5 z-40 hidden items-center gap-2 rounded-full border border-border bg-background/95 p-2 shadow-xl backdrop-blur md:flex">
            <RoomJumpSelect
              rooms={sortedRooms}
              value={jumpRoomId}
              onJump={jumpToRoom}
              compact
              className="w-[210px]"
            />
            <button
              type="button"
              onClick={scrollToTop}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-ink text-primary-foreground hover:bg-ink/90"
              title="Return to top"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function RoomMaterialsSection({
  room,
  items,
  products,
  projectId,
  planEvidence,
  planTitle,
  planStatus,
  planMessage,
  onReviewPlans,
  reviewItemId,
}: {
  room: Room;
  items: MaterialItem[];
  products: Product[];
  projectId: string;
  planEvidence?: BathroomPlanEvidence;
  planTitle: string;
  planStatus: "idle" | "checking" | "checked" | "error" | "no_document";
  planMessage?: string;
  onReviewPlans: () => void;
  reviewItemId?: string;
}) {
  const qc = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activatedSuggestionKeys, setActivatedSuggestionKeys] = useState<string[]>([]);
  const [linkProgress, setLinkProgress] = useState<Record<string, string>>({});
  const [bulkOrderedBy, setBulkOrderedBy] = useState<MaterialItem["ordered_by"] | "none">("none");
  const [approvalFilter, setApprovalFilter] = useState<"all" | "needs_reselection">("all");
  const focusedReviewItem = useRef<string | null>(null);
  useEffect(() => {
    if (reviewItemId) setApprovalFilter("all");
  }, [reviewItemId]);
  const activatedSuggestionKeySet = useMemo(
    () => new Set(activatedSuggestionKeys),
    [activatedSuggestionKeys],
  );
  const templateSuggestions = useMemo<MaterialSuggestion[]>(() => {
    const chosenItems = items.filter(
      (item) => !item.not_needed && !isUntouchedTemplatePlaceholder(item),
    );
    return suggestedTemplatesForRoom(templateForRoomName(room.name, planEvidence?.shower === "present"), planEvidence).flatMap((templateItem) => {
      const key = normalizeMaterialSuggestionLabel(templateItem.label);
      if (activatedSuggestionKeySet.has(key)) return [];
      const matchingItems = items.filter(
        (item) => normalizeMaterialSuggestionLabel(item.item_label) === key,
      );
      if (matchingItems.some((item) => item.not_needed)) return [];
      if (chosenItems.some((item) => materialCoversTemplateSuggestion(item, templateItem, room.name))) {
        return [];
      }
      return [
        {
          key,
          label: templateItem.label,
          category: templateItem.category,
          existingItem:
            matchingItems.find((item) => isUntouchedTemplatePlaceholder(item)) ?? null,
        },
      ];
    });
  }, [activatedSuggestionKeySet, items, room.name, planEvidence]);
  const activeItems = useMemo(
    () =>
      items.filter(
        (item) =>
          !item.not_needed &&
          (!isUntouchedTemplatePlaceholder(item) ||
            activatedSuggestionKeySet.has(normalizeMaterialSuggestionLabel(item.item_label))),
      ),
    [activatedSuggestionKeySet, items],
  );
  const done = activeItems.filter(
    (it) => it.product_url && it.product_url.trim().length > 0,
  ).length;
  const reselectionCount = activeItems.filter((it) => isNeedsReselection(it)).length;
  const sortedItems = useMemo(
    () =>
      [...activeItems]
        .filter((item) => approvalFilter === "all" || isNeedsReselection(item))
        .sort((a, b) =>
          a.item_label.localeCompare(b.item_label, undefined, { sensitivity: "base" }),
        ),
    [activeItems, approvalFilter],
  );
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  useEffect(() => {
    if (!reviewItemId || focusedReviewItem.current === reviewItemId || !sortedItems.some(item => item.id === reviewItemId)) return;
    const row = document.getElementById(materialRowId(reviewItemId));
    if (!row) return;
    const frame = requestAnimationFrame(() => {
      row.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      row.focus({ preventScroll: true });
      focusedReviewItem.current = reviewItemId;
    });
    return () => cancelAnimationFrame(frame);
  }, [reviewItemId, sortedItems]);
  const validSelectedIds = useMemo(
    () => selectedIds.filter((id) => sortedItems.some((item) => item.id === id)),
    [selectedIds, sortedItems],
  );
  const allSelected = sortedItems.length > 0 && validSelectedIds.length === sortedItems.length;
  const someSelected = validSelectedIds.length > 0;
  const roomInitial = (room.name.trim().charAt(0) || "R").toUpperCase();
  const cadOptions = sortedItems.map((it, index) => ({
    itemId: it.id,
    value: `${roomInitial}-${String(index + 1).padStart(2, "0")}`,
  }));
  const usedCadLabels = new Set(
    sortedItems.map((it) => it.cad_label?.trim()).filter((label): label is string => !!label),
  );
  const cadLabelOwner = new Map<string, string>();
  for (const item of sortedItems) {
    const label = item.cad_label?.trim();
    if (label && !cadLabelOwner.has(label)) cadLabelOwner.set(label, item.id);
  }

  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["materialItems", projectId] }),
      qc.invalidateQueries({ queryKey: ["procurement"] }),
    ]);

  const activateSuggestion = async (
    suggestion: MaterialSuggestion,
    productUrl: string | null,
  ) => {
    if (productUrl) {
      const result = await saveAndScrapeMaterialLink({ projectId, roomId: room.id, label: suggestion.label, productUrl, existingItem: suggestion.existingItem });
      if (result.warning) toast.warning(result.warning);
      await Promise.all([["materialItems", projectId], ["catalog"], ["products"], ["roomProducts", room.id], ["spec-completion-review", projectId], ["procurement"]].map(queryKey => qc.invalidateQueries({ queryKey })));
      return;
    }
    setActivatedSuggestionKeys((current) =>
      current.includes(suggestion.key) ? current : [...current, suggestion.key],
    );
    if (suggestion.existingItem) {
      await db.updateMaterialItem(suggestion.existingItem.id, {
        is_required: false,
        not_needed: false,
        product_url: productUrl,
        scrape_status: "pending",
        scrape_error: null,
      });
    } else {
      await db.bulkInsertMaterialItems([
        {
          room_id: room.id,
          project_id: projectId,
          item_label: suggestion.label,
          client_product_name: buildClientProductName(room.name, suggestion.label),
          category: suggestion.category,
          is_required: false,
          sort_order: items.length,
          cad_label: null,
          product_url: productUrl,
          quantity: null,
          color: null,
          image_url: null,
          notes: null,
          not_needed: false,
          product_id: null,
          source_board_id: null,
          source_board_page_id: null,
          source_board_element_id: null,
          ordered_by: null,
          ordered: false,
          scrape_status: "pending",
          scrape_error: null,
        },
      ]);
    }
    invalidate();
  };

  const dismissSuggestion = async (suggestion: MaterialSuggestion) => {
    setActivatedSuggestionKeys((current) =>
      current.includes(suggestion.key) ? current : [...current, suggestion.key],
    );
    if (suggestion.existingItem) {
      await db.updateMaterialItem(suggestion.existingItem.id, { not_needed: true });
    } else {
      await db.bulkInsertMaterialItems([
        {
          room_id: room.id,
          project_id: projectId,
          item_label: suggestion.label,
          client_product_name: buildClientProductName(room.name, suggestion.label),
          category: suggestion.category,
          is_required: true,
          sort_order: items.length,
          cad_label: null,
          product_url: null,
          quantity: null,
          color: null,
          image_url: null,
          notes: null,
          not_needed: true,
          product_id: null,
          source_board_id: null,
          source_board_page_id: null,
          source_board_element_id: null,
          ordered_by: null,
          ordered: false,
          scrape_status: "pending",
          scrape_error: null,
        },
      ]);
    }
    invalidate();
  };

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => sortedItems.some((item) => item.id === id)));
  }, [sortedItems]);

  const update = async (id: string, patch: Partial<MaterialItem>) => {
    if (!isUuid(id)) { toast.error("Could not save this item because its ID is invalid."); return; }
    const currentItem = activeItems.find((item) => item.id === id);
    if (!currentItem) { toast.error("Could not find this material item."); return; }

    try {
      if (typeof patch.product_url === "string" && patch.product_url.trim()) {
        if (linkProgress[id]) return;
        setLinkProgress(current => ({ ...current, [id]: "Saving link…" }));
        try {
          const result = await saveAndScrapeMaterialLink({ projectId, roomId: room.id, label: currentItem.item_label, productUrl: patch.product_url, existingItem: currentItem,
            onProgress: message => setLinkProgress(current => ({ ...current, [id]: message })) });
          if (result.warning) toast.warning(result.warning);
          else toast.success("Product link and available product details saved.");
          await Promise.all([["materialItems", projectId], ["catalog"], ["products"], ["roomProducts", room.id], ["spec-completion-review", projectId], ["procurement"]].map(queryKey => qc.invalidateQueries({ queryKey })));
        } finally { setLinkProgress(current => { const next = { ...current }; delete next[id]; return next; }); }
        return;
      }
      const result = await db.updateMaterialItem(id, patch);
      if (result.error) throw result.error;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save this material item.");
      return;
    }
    if (
      typeof patch.category === "string" &&
      currentItem?.product_id &&
      isUuid(currentItem.product_id)
    ) {
      await db.updateProduct(
        currentItem.product_id,
        productCategoryPatchForMaterialCategory(patch.category),
      );
      qc.invalidateQueries({ queryKey: ["catalog"] });
      qc.invalidateQueries({ queryKey: ["product", currentItem.product_id] });
    }
    invalidate();
  };

  const toggleSelected = (itemId: string, checked: boolean) => {
    setSelectedIds((current) => {
      if (checked) return current.includes(itemId) ? current : [...current, itemId];
      return current.filter((id) => id !== itemId);
    });
  };

  const toggleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? sortedItems.map((item) => item.id) : []);
  };

  const bulkUpdate = async (patch: Partial<MaterialItem>, successMessage: string) => {
    const ids = validSelectedIds.filter(isUuid);
    if (ids.length === 0) return toast.error("Select at least one item first.");
    await Promise.all(ids.map((id) => db.updateMaterialItem(id, patch)));
    invalidate();
    toast.success(successMessage);
  };

  const applyBulkOrderedBy = async () => {
    await bulkUpdate(
      { ordered_by: bulkOrderedBy === "none" ? null : bulkOrderedBy },
      `Updated ${validSelectedIds.length} item${validSelectedIds.length === 1 ? "" : "s"}.`,
    );
  };

  const renameRoom = async (nextName: string) => {
    const name = nextName.trim();
    if (!name) return toast.error("Room name required.");
    if (name === room.name) return;

    await db.updateRoom(room.id, { name } as Partial<Room>);
    await Promise.all(
      activeItems.map((item) =>
        db.updateMaterialItem(item.id, {
          client_product_name: buildClientProductName(name, item.item_label),
        }),
      ),
    );
    qc.invalidateQueries({ queryKey: ["rooms", projectId] });
    qc.invalidateQueries({ queryKey: ["room", room.id] });
    qc.invalidateQueries({ queryKey: ["materialItems", projectId] });
    toast.success(`Renamed room to ${name}`);
  };

  const remove = async (id: string) => {
    if (!isUuid(id)) return toast.error("Could not delete this item because its ID is invalid.");
    if (!confirm("Delete this item?")) return;
    await db.deleteMaterialItem(id);
    invalidate();
  };

  const attachCatalogProduct = async (item: MaterialItem, productId: string | null) => {
    if (linkProgress[item.id]) return;
    const safeProductId = cleanUuid(productId);
    if (!isUuid(item.id) || !isUuid(room.id)) {
      toast.error("Could not link this product because the item ID is invalid.");
      return;
    }
    const product = safeProductId ? products.find((p) => p.id === safeProductId) : null;
    if (productId && !product) return toast.error("Refresh the catalog before choosing this product.");
    setLinkProgress(current => ({ ...current, [item.id]: "Saving catalog selection…" }));
    let selectionSaved = false;
    try {
      const color = product && item.product_id === product.id && item.color ? item.color : product?.finish || item.color || null;
      const { data: saved, error } = await supabase.from("material_items").update({
        product_id: product?.id ?? null, product_url: product ? product.product_url : (item.product_url ?? null),
        color, scrape_status: product ? "scraped" : "pending", scrape_error: null, not_needed: false,
      }).eq("id", item.id).eq("project_id", projectId).eq("room_id", room.id).eq("updated_at", item.updated_at).select("id").maybeSingle();
      if (error) throw error;
      if (!saved) throw new Error("This material changed. Refresh before choosing a catalog product.");
      selectionSaved = true;
      if (product) {
        const roomProducts = await db.listRoomProducts(room.id);
        if (!roomProducts) throw new Error("Could not confirm the room connection.");
        if (!roomProducts.some(rp => rp.product_id === product.id) &&
          !await db.addRoomProduct({ room_id: room.id, product_id: product.id, is_key_selection: false }))
          throw new Error("Could not save the room connection.");
        const warning = await refreshCatalogSelectionIfNeeded({ projectId, itemId: item.id, product, material: { ...item, color },
          onProgress: message => setLinkProgress(current => ({ ...current, [item.id]: message })) });
        if (warning) toast.warning(warning);
        else toast.success(`Added ${product.name} to ${item.item_label}`);
      }
    } catch (error) {
      if (selectionSaved) toast.warning("The catalog selection is saved. Refresh Materials to confirm its room connection and product details.");
      else toast.error(error instanceof Error ? error.message : "Could not save the catalog selection.");
    } finally {
      await Promise.all([["materialItems", projectId], ["catalog"], ["products"], ["roomProducts", room.id], ["spec-completion-review", projectId], ["procurement"]]
        .map(queryKey => qc.invalidateQueries({ queryKey })));
      setLinkProgress(current => { const next = { ...current }; delete next[item.id]; return next; });
    }
  };

  return (
    <section id={roomSectionId(room.id)} className="scroll-mt-8 border border-border bg-background">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bone/30">
        <div className="flex items-baseline gap-4">
          <h2 className="font-display text-2xl">{room.name}</h2>
          <EditRoomNameButton currentName={room.name} onSave={renameRoom} />
          <span className="text-xs text-muted-foreground tracking-wide">
            {done} of {activeItems.length} completed
          </span>
        </div>
        <div className="flex items-center gap-2">
          {templateSuggestions.length > 0 && (
            <MaterialSuggestionReview
              roomName={room.name}
              roomId={room.id}
              projectId={projectId}
              planEvidence={planEvidence}
              planTitle={planTitle}
              planStatus={planStatus}
              planMessage={planMessage}
              onReviewPlans={onReviewPlans}
              suggestions={templateSuggestions}
              onAdd={activateSuggestion}
              onDismiss={dismissSuggestion}
              onCatalogAdded={invalidate}
            />
          )}
          <AddCustomItemButton
            roomId={room.id}
            roomName={room.name}
            projectId={projectId}
            sortStart={items.length}
          />
        </div>
      </div>

      {activeItems.length === 0 ? (
        <div className="px-6 py-10 text-sm text-muted-foreground">
          No materials added yet.
          {templateSuggestions.length > 0
            ? " Review the possible items above or add a custom item."
            : " Add a custom item when you are ready."}
        </div>
      ) : (
        <div className="mobile-card-scroll">
          <div className="flex flex-wrap items-end gap-3 border-b border-border bg-background px-6 py-3">
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              {validSelectedIds.length} selected
            </div>
            {reselectionCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  setApprovalFilter((current) =>
                    current === "needs_reselection" ? "all" : "needs_reselection",
                  )
                }
                className={`h-9 border px-3 text-xs tracking-wide ${
                  approvalFilter === "needs_reselection"
                    ? "border-red-700 bg-red-50 text-red-800"
                    : "border-border text-red-700 hover:border-red-700"
                }`}
              >
                Needs re-selection ({reselectionCount})
              </button>
            )}
            <button
              type="button"
              onClick={() => toggleSelectAll(!allSelected)}
              className="h-9 border border-border px-3 text-xs tracking-wide hover:border-ink"
            >
              {allSelected ? "Clear Selection" : "Select All Room"}
            </button>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Ordered By
              </span>
              <Select
                value={bulkOrderedBy ?? "none"}
                onValueChange={(value) =>
                  setBulkOrderedBy(
                    value === "none" ? "none" : (value as MaterialItem["ordered_by"]),
                  )
                }
              >
                <SelectTrigger className="h-9 w-[150px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not set</SelectItem>
                  {ORDERED_BY_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                type="button"
                disabled={!someSelected}
                onClick={applyBulkOrderedBy}
                className="h-9 bg-ink px-3 text-xs text-primary-foreground disabled:opacity-40"
              >
                Apply
              </button>
            </div>
            <button
              type="button"
              disabled={!someSelected}
              onClick={() =>
                bulkUpdate(
                  { ordered: true },
                  `Marked ${validSelectedIds.length} item${validSelectedIds.length === 1 ? "" : "s"} ordered.`,
                )
              }
              className="h-9 border border-border px-3 text-xs tracking-wide hover:border-ink disabled:opacity-40"
            >
              Mark Ordered
            </button>
            <button
              type="button"
              disabled={!someSelected}
              onClick={() =>
                bulkUpdate(
                  { ordered: false },
                  `Marked ${validSelectedIds.length} item${validSelectedIds.length === 1 ? "" : "s"} not ordered.`,
                )
              }
              className="h-9 border border-border px-3 text-xs tracking-wide hover:border-ink disabled:opacity-40"
            >
              Mark Not Ordered
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] tracking-[0.15em] uppercase text-muted-foreground">
                <th className="px-6 py-3 w-[52px]">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(event) => toggleSelectAll(event.target.checked)}
                    className="h-4 w-4 accent-ink"
                    aria-label={`Select all ${room.name} materials`}
                  />
                </th>
                <th className="px-6 py-3 w-[180px]">Item</th>
                <th className="py-3 w-[220px]">Client Product Name</th>
                <th className="py-3 w-[140px]">Category</th>
                <th className="py-3 w-[120px]">CAD Label</th>
                <th className="py-3">Product Link</th>
                <th className="py-3 w-[100px]">Price</th>
                <th className="py-3 w-[72px]">Qty</th>
                <th className="py-3 w-[130px]">Ordered By</th>
                <th className="py-3 w-[88px]">Ordered</th>
                <th className="py-3 w-[140px]">Color / Finish</th>
                <th className="py-3 w-[60px]">Notes</th>
                <th className="px-4 py-3 w-[40px]"></th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((it) => {
                const hasProductLink = !!(it.product_url && it.product_url.trim().length > 0);
                const complete = hasProductLink;
                const linkedProductId = cleanUuid(it.product?.id);
                const needsReselection = isNeedsReselection(it);
                return (
                  <tr
                    key={it.id}
                    id={materialRowId(it.id)}
                    tabIndex={reviewItemId === it.id ? -1 : undefined}
                    aria-label={reviewItemId === it.id ? `Review item: ${it.item_label}` : undefined}
                    className={`border-t border-border align-middle scroll-mt-24 ${reviewItemId === it.id ? "bg-amber-50 outline outline-2 -outline-offset-2 outline-amber-400" : needsReselection ? "bg-red-50/35" : ""}`}
                  >
                    <td className="px-6 py-3">
                      <input
                        type="checkbox"
                        checked={selectedSet.has(it.id)}
                        onChange={(event) => toggleSelected(it.id, event.target.checked)}
                        className="h-4 w-4 accent-ink"
                        aria-label={`Select ${it.item_label}`}
                      />
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${complete ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
                          title={complete ? "Complete" : "Incomplete"}
                        />
                        <span>{it.item_label}</span>
                        <EditItemNameButton
                          currentName={it.item_label}
                          onSave={(nextName) =>
                            update(it.id, {
                              item_label: nextName,
                              client_product_name: buildClientProductName(room.name, nextName),
                              category: inferMaterialCategory(nextName, it.product_url),
                            })
                          }
                        />
                        {!it.is_required &&
                          !templateForRoomName(room.name).some(
                            (templateItem) =>
                              normalizeMaterialSuggestionLabel(templateItem.label) ===
                              normalizeMaterialSuggestionLabel(it.item_label),
                          ) && (
                          <span className="text-[10px] tracking-wider uppercase text-muted-foreground">
                            Custom
                          </span>
                          )}
                        {it.product && (
                          <span className="text-[10px] tracking-wider uppercase text-emerald-700">
                            Scraped
                          </span>
                        )}
                        {!hasProductLink && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium tracking-wide text-amber-800">
                            <AlertTriangle className="h-3 w-3" />
                            Needs Link
                          </span>
                        )}
                        {needsReselection && <NeedsReselectionBadge />}
                        <FinishCheckBadge item={it} />
                      </div>
                      <CatalogProductPicker
                        item={it}
                        products={products}
                        onSelect={(productId) => attachCatalogProduct(it, productId)}
                        disabled={!!linkProgress[it.id]}
                      />
                      <MaterialPhotoUpload item={it} projectId={projectId} />
                      <div className="mt-2 pl-3.5"><MaterialDetailsEditor item={it} /></div>
                      {it.product && linkedProductId && (
                        <Link
                          to="/catalog/$productId"
                          params={{ productId: linkedProductId }}
                          className="mt-2 flex items-center gap-2 pl-3.5 group/product"
                        >
                          <div className="min-w-0">
                            <div
                              className="text-xs text-ink truncate max-w-[200px] underline-offset-4 group-hover/product:underline"
                              title={it.product.name}
                            >
                              {it.product.name}
                            </div>
                            <div className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                              {[it.product.vendor, formatPriceWithUnit(it.product.price, materialPriceUnit(it)), it.product.dimensions]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          </div>
                        </Link>
                      )}
                      <FinishCheckDetails item={it} />
                    </td>
                    <td className="py-2 pr-3">
                      <InlineInput
                        value={clientProductName(it, room)}
                        onSave={(v) =>
                          update(it.id, {
                            client_product_name:
                              v || buildClientProductName(room.name, it.item_label),
                          })
                        }
                        placeholder="Kitchen Pendant"
                      />
                      {actualProductName(it, room) && (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {actualProductName(it, room)}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <Select
                        value={normalizeItemCategory(it.category) ?? "Other"}
                        onValueChange={(v) => update(it.id, { category: v })}
                      >
                        <SelectTrigger className="h-8 border-transparent hover:border-input focus:border-input bg-transparent text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ALL_CATEGORIES.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-2 pr-3">
                      <CadLabelSelect
                        value={it.cad_label}
                        options={cadOptions.filter((option) => {
                          const ownerId = cadLabelOwner.get(option.value);
                          return !usedCadLabels.has(option.value) || ownerId === it.id;
                        })}
                        onSave={(v) => update(it.id, { cad_label: v })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <InlineInput
                        value={it.product_url ?? ""}
                        disabled={!!linkProgress[it.id]}
                        onSave={(v) =>
                          update(it.id, { product_url: v || null, scrape_status: "pending" })
                        }
                        className={
                          !hasProductLink
                            ? "border-amber-300 bg-amber-50/60 focus-visible:border-amber-500 focus-visible:ring-amber-200"
                            : undefined
                        }
                      />
                      {linkProgress[it.id] && <p role="status" className="mt-1 text-[11px] text-muted-foreground">{linkProgress[it.id]}</p>}
                      {!hasProductLink && (
                        <div className="mt-1 text-[11px] text-amber-800">
                          Add a product link to automatically get its image, price, dimensions and color.
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      <MaterialDetailsEditor item={it} trigger="price" />
                    </td>
                    <td className="py-2 pr-3">
                      <SpecQuantityEditor item={it} label={it.item_label}
                        onSave={async (patch) => { await db.updateMaterialQuantity(it.id, patch); invalidate(); }} />
                    </td>
                    <td className="py-2 pr-3">
                      <Select
                        value={it.ordered_by ?? "none"}
                        onValueChange={(v) =>
                          update(it.id, {
                            ordered_by: v === "none" ? null : (v as MaterialItem["ordered_by"]),
                          })
                        }
                      >
                        <SelectTrigger className="h-8 border-transparent hover:border-input focus:border-input bg-transparent text-xs">
                          <SelectValue placeholder="Choose" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Not set</SelectItem>
                          {ORDERED_BY_OPTIONS.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-2 pr-3">
                      <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={it.ordered === true}
                          onChange={(event) => update(it.id, { ordered: event.target.checked })}
                          className="h-4 w-4 accent-ink"
                        />
                        Yes
                      </label>
                    </td>
                    <td className="py-2 pr-3">
                      <InlineInput
                        value={it.color ?? ""}
                        onSave={(v) => update(it.id, { color: v || null })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <NotesPopover
                        value={it.notes ?? ""}
                        onSave={(v) => update(it.id, { notes: v || null })}
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => remove(it.id)}
                        className="text-muted-foreground hover:text-ink"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RoomJumpSelect({
  rooms,
  value,
  onJump,
  compact = false,
  className = "",
}: {
  rooms: Room[];
  value: string;
  onJump: (roomId: string) => void;
  compact?: boolean;
  className?: string;
}) {
  if (rooms.length === 0) return null;

  return (
    <Select value={value || undefined} onValueChange={onJump}>
      <SelectTrigger
        className={`${compact ? "h-10 rounded-full" : "h-11"} border-border bg-background text-sm ${className}`}
      >
        <SelectValue placeholder="Jump to room" />
      </SelectTrigger>
      <SelectContent>
        {rooms.map((room) => (
          <SelectItem key={room.id} value={room.id}>
            {room.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function EditRoomNameButton({
  currentName,
  onSave,
}: {
  currentName: string;
  onSave: (name: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setName(currentName);
  }, [currentName, open]);

  const submit = async () => {
    setSaving(true);
    try {
      await onSave(name);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setName(currentName);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-ink"
        >
          <Pencil className="h-3 w-3" /> Edit
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">Edit Room Name</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="eyebrow">Room Name</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Kitchen"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            This will also update this room's client product names.
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="w-full py-3 bg-ink text-primary-foreground text-sm disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Room Name"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function actualProductName(item: MaterialItem, room: Room) {
  const actualName = item.product?.name?.trim();
  if (!actualName) return null;
  const clientName = clientProductName(item, room).trim();
  return actualName.toLocaleLowerCase() === clientName.toLocaleLowerCase() ? null : actualName;
}

function EditItemNameButton({
  currentName,
  onSave,
}: {
  currentName: string;
  onSave: (name: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setName(currentName);
  }, [currentName, open]);

  const submit = async () => {
    const nextName = name.trim();
    if (!nextName) {
      toast.error("Item name required.");
      return;
    }
    setSaving(true);
    try {
      await onSave(nextName);
      toast.success(`Renamed item to ${nextName}`);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setName(currentName);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-ink"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">Edit Item Name</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="eyebrow">Item Name</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Pendant"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            This will also update the client product name for this row.
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="w-full py-3 bg-ink text-primary-foreground text-sm disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Item Name"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CatalogProductPicker({
  item,
  products,
  onSelect,
  disabled,
}: {
  item: MaterialItem;
  products: Product[];
  onSelect: (productId: string | null) => void;
  disabled?: boolean;
}) {
  const category = toProductCategory(item.category);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const matchingProducts = products.filter(
    (product) => product.category === category && isUuid(product.id),
  );
  const currentProductId = cleanUuid(item.product_id);
  const selectedProduct = currentProductId
    ? products.find((product) => product.id === currentProductId)
    : null;
  const searchedProducts = matchingProducts
    .filter((product) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return [product.name, product.vendor, product.finish, product.sku]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(q));
    })
    .slice(0, 40);

  const choose = (productId: string | null) => {
    onSelect(productId);
    setOpen(false);
    setSearch("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setSearch("");
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="mt-1 block pl-3.5 text-[11px] text-muted-foreground underline-offset-4 hover:text-ink hover:underline disabled:pointer-events-none disabled:opacity-40"
        >
          {selectedProduct ? "Change catalog product" : "Assign from catalog"}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">
            Assign Catalog Product
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Choose a {category.toLowerCase()} product to attach to{" "}
            <span className="text-ink">{item.item_label}</span>.
            {" "}Missing images, prices, dimensions and colors are filled automatically from its product link when available.
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Search ${category.toLowerCase()} products`}
              className="pl-9"
            />
          </div>
          {selectedProduct && (
            <button
              type="button"
              onClick={() => choose(null)}
              className="w-full text-left border border-border p-3 text-sm hover:border-ink"
            >
              Clear catalog product
              <span className="block text-xs text-muted-foreground">
                Keeps the row, but removes the catalog assignment.
              </span>
            </button>
          )}
          <div className="max-h-[420px] overflow-y-auto border border-border divide-y divide-border">
            {searchedProducts.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No {category.toLowerCase()} products found in the catalog yet.
              </div>
            ) : (
              searchedProducts.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => choose(product.id)}
                  className={`w-full grid grid-cols-[64px_1fr] gap-4 p-3 text-left hover:bg-bone/50 ${product.id === currentProductId ? "bg-bone" : ""}`}
                >
                  {product.image_url ? (
                    <img
                      src={normalizeSupabaseImageUrl(product.image_url)}
                      alt=""
                      className="h-16 w-16 object-cover bg-bone border border-border"
                    />
                  ) : (
                    <div className="h-16 w-16 bg-bone border border-border" />
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm text-ink truncate">{product.name}</span>
                    <span className="block text-xs text-muted-foreground truncate">
                      {[product.vendor, product.finish, formatPriceWithUnit(product.price, inferProductPriceUnit(product))].filter(Boolean).join(" · ")}
                    </span>
                    {product.product_url && (
                      <span className="block text-[11px] text-muted-foreground truncate">
                        {product.product_url}
                      </span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CadLabelSelect({
  value,
  options,
  onSave,
  disabled,
}: {
  value: string | null;
  options: Array<{ itemId: string; value: string }>;
  onSave: (v: string | null) => void;
  disabled?: boolean;
}) {
  const normalizedValue = value?.trim() || "__none__";
  const hasCurrentValue =
    normalizedValue !== "__none__" && options.some((option) => option.value === normalizedValue);

  return (
    <Select
      value={normalizedValue}
      onValueChange={(next) => onSave(next === "__none__" ? null : next)}
      disabled={disabled}
    >
      <SelectTrigger className="h-8 border-transparent hover:border-input focus:border-input bg-transparent text-xs">
        <SelectValue placeholder="CAD label" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">No label</SelectItem>
        {!hasCurrentValue && normalizedValue !== "__none__" && (
          <SelectItem value={normalizedValue}>{normalizedValue}</SelectItem>
        )}
        {options.map((option) => (
          <SelectItem key={option.itemId} value={option.value}>
            {option.value}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function InlineInput({
  value,
  onSave,
  type = "text",
  disabled,
  placeholder,
  className,
}: {
  value: string;
  onSave: (v: string) => void;
  type?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => {
    setLocal(value);
  }, [value]);
  return (
    <Input
      value={local}
      type={type}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== value) onSave(local);
      }}
      className={`h-8 border-transparent hover:border-input focus:border-input bg-transparent ${className ?? ""}`}
    />
  );
}

function NotesPopover({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState(value);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setLocal(value);
      }}
    >
      <DialogTrigger asChild>
        <button
          className={`text-xs underline-offset-4 hover:underline ${value ? "text-ink" : "text-muted-foreground"}`}
        >
          {value ? "Edit" : "Add"}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl font-normal">Notes</DialogTitle>
        </DialogHeader>
        <Textarea value={local} onChange={(e) => setLocal(e.target.value)} rows={5} />
        <button
          onClick={() => {
            onSave(local);
            setOpen(false);
          }}
          className="w-full py-2.5 bg-ink text-primary-foreground text-sm"
        >
          Save
        </button>
      </DialogContent>
    </Dialog>
  );
}

export function MaterialSuggestionReview({
  roomName,
  roomId,
  suggestions,
  onAdd,
  onDismiss,
  projectId,
  planEvidence,
  planTitle,
  planStatus,
  planMessage,
  onReviewPlans,
  onCatalogAdded,
}: {
  roomName: string;
  roomId?: string;
  suggestions: MaterialSuggestion[];
  onAdd: (suggestion: MaterialSuggestion, productUrl: string | null) => Promise<void>;
  onDismiss: (suggestion: MaterialSuggestion) => Promise<void>;
  projectId: string;
  planEvidence?: BathroomPlanEvidence;
  planTitle: string;
  planStatus: "idle" | "checking" | "checked" | "error" | "no_document";
  planMessage?: string;
  onReviewPlans: () => void;
  onCatalogAdded?: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [linksByKey, setLinksByKey] = useState<Record<string, string>>({});

  if (suggestions.length === 0) return null;

  const choose = async (suggestion: MaterialSuggestion, choice: "add" | "dismiss") => {
    if (savingKey) return;
    const productUrl = linksByKey[suggestion.key]?.trim() || null;
    if (choice === "add" && productUrl) {
      try {
        const parsedUrl = new URL(productUrl);
        if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") throw new Error();
      } catch {
        toast.error("Paste the full product link, starting with http:// or https://.");
        return;
      }
    }
    setSavingKey(suggestion.key);
    try {
      if (choice === "add") {
        await onAdd(suggestion, productUrl);
        toast.success(
          productUrl
            ? `${suggestion.label} added to ${roomName} with its product link.`
            : `${suggestion.label} added to ${roomName} for later selection.`,
        );
      } else {
        await onDismiss(suggestion);
        toast.success(`${suggestion.label} marked not needed for ${roomName}.`);
      }
      setLinksByKey((current) => {
        const next = { ...current };
        delete next[suggestion.key];
        return next;
      });
    } catch (error) {
      console.error(error);
      toast.error(`Could not save the ${suggestion.label} choice. Please try again.`);
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (savingKey) return;
      setOpen(nextOpen);
      if (nextOpen) onReviewPlans();
    }}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 hover:border-amber-500"
        >
          <Sparkles className="h-3 w-3" />
          Review {suggestions.length} possible {suggestions.length === 1 ? "item" : "items"}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">
            Possible items for {roomName}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/bath|powder/i.test(roomName) && (
            <div role="status" className="border border-border bg-muted/30 px-4 py-3 text-sm leading-relaxed">
              {planStatus === "checking" ? "Checking the latest construction document…" :
                planStatus === "no_document" ? "No construction document is available yet. Review these suggestions for this room." :
                planStatus === "error" ? planMessage || "Could not check the latest plans. Shower suggestions remain available for review." :
                confirmedNoShower(planEvidence) ? "Latest plans show no shower in this bathroom. Shower items are omitted from these suggestions." :
                planEvidence?.shower === "present" ? "A shower is shown in this bathroom’s latest plans." :
                "The shower layout is not confirmed. Review shower suggestions against the plans."}
              {planStatus === "checked" && planEvidence?.page && (
                <div className="mt-2 text-muted-foreground">
                  <Link to="/projects/$id/construction-docs" params={{ id: projectId }} className="underline">
                    {planTitle || "Construction document"}
                  </Link> · page {planEvidence.page}{planEvidence.sheet ? ` · ${planEvidence.sheet}` : ""}
                  <p className="mt-1">{planEvidence.evidence}</p>
                </div>
              )}
            </div>
          )}
          <p className="text-sm leading-relaxed text-muted-foreground">
            Choose a suggestion from your catalog, paste a product link, or add a placeholder for
            later. Adding a link automatically gets the image, price, dimensions and color. Anything untouched will still be here the next time you open this list.
          </p>
          <div className="max-h-[60vh] divide-y divide-border overflow-y-auto border border-border">
            {suggestions.map((suggestion) => {
              const saving = savingKey === suggestion.key;
              const productUrl = linksByKey[suggestion.key] ?? "";
              return (
                <div
                  key={suggestion.key}
                  className="grid gap-3 p-4 md:grid-cols-[minmax(130px,0.7fr)_minmax(180px,1fr)_minmax(200px,1fr)] md:items-center"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-ink">{suggestion.label}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {suggestion.category}
                    </div>
                  </div>
                  <Input
                    type="url"
                    value={productUrl}
                    disabled={savingKey !== null}
                    onChange={(event) =>
                      setLinksByKey((current) => ({
                        ...current,
                        [suggestion.key]: event.target.value,
                      }))
                    }
                    placeholder="Paste product link"
                    aria-label={`${suggestion.label} product link`}
                    className="h-9"
                  />
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {roomId && <MaterialCatalogSuggestions projectId={projectId} roomId={roomId} roomName={roomName}
                      label={suggestion.label} existingItem={suggestion.existingItem} disabled={savingKey !== null}
                      onAdded={async () => { await onCatalogAdded?.(); }} />}
                    <button
                      type="button"
                      disabled={savingKey !== null}
                      onClick={() => choose(suggestion, "add")}
                      className="bg-ink px-3 py-2 text-xs text-primary-foreground disabled:opacity-50"
                    >
                      {saving ? productUrl.trim() ? "Getting product info…" : "Saving…" : productUrl.trim() ? "Add with link" : "Add for later"}
                    </button>
                    <button
                      type="button"
                      disabled={savingKey !== null}
                      onClick={() => choose(suggestion, "dismiss")}
                      className="border border-border px-3 py-2 text-xs hover:border-ink disabled:opacity-50"
                    >
                      Not needed
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-right text-xs text-muted-foreground">
            {suggestions.length} possible {suggestions.length === 1 ? "item" : "items"} remaining
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddCustomItemButton({
  roomId,
  roomName,
  projectId,
  sortStart,
}: {
  roomId: string;
  roomName: string;
  projectId: string;
  sortStart: number;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<string>("Other");

  const submit = async () => {
    if (!label.trim()) return toast.error("Label required");
    if (!isUuid(roomId) || !isUuid(projectId))
      return toast.error("Could not add this item because the project link is invalid.");
    await db.bulkInsertMaterialItems([
      {
        room_id: roomId,
        project_id: projectId,
        item_label: label.trim(),
        client_product_name: buildClientProductName(roomName, label.trim()),
        category: category === "Other" ? inferMaterialCategory(label.trim()) : category,
        is_required: false,
        sort_order: sortStart,
        cad_label: null,
        product_url: null,
        quantity: null,
        color: null,
        notes: null,
        not_needed: false,
        product_id: null,
        scrape_status: "pending",
        scrape_error: null,
      },
    ]);
    qc.invalidateQueries({ queryKey: ["materialItems", projectId] });
    qc.invalidateQueries({ queryKey: ["procurement"] });
    setLabel("");
    setCategory("Other");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border hover:border-ink">
          <Plus className="w-3 h-3" /> Add custom item
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl font-normal">Add custom item</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="eyebrow">Item label</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Vent Hood Insert"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="eyebrow">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <button onClick={submit} className="w-full py-2.5 bg-ink text-primary-foreground text-sm">
            Add
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

async function importLargePdf(projectId: string, file: File) {
  const uploadRes = await fetch("/api/import-materials-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "create_upload",
      project_id: projectId,
      file_name: file.name,
      content_type: file.type || "application/pdf",
    }),
  });
  const uploadBody = await readJsonResponse(uploadRes);
  if (!uploadRes.ok) throw new Error(uploadBody?.error || "Could not prepare PDF upload");

  const { error: uploadError } = await supabase.storage
    .from(uploadBody.bucket)
    .uploadToSignedUrl(uploadBody.path, uploadBody.token, file, {
      contentType: file.type || "application/pdf",
    });
  if (uploadError) throw new Error(uploadError.message || "Could not upload PDF");

  return fetch("/api/import-materials-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: projectId,
      replace_existing_custom: true,
      storage_path: uploadBody.path,
    }),
  });
}

function pdfImportFormData(projectId: string, file: File) {
  const form = new FormData();
  form.append("project_id", projectId);
  form.append("replace_existing_custom", "true");
  form.append("pdf", file);
  return form;
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return {
      error:
        response.status === 413 || /request entity too large/i.test(text)
          ? "That PDF is too large to upload directly. Try again and the browser-side importer will process it locally."
          : text,
    };
  }
}
