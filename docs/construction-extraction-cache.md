# Shared construction-document extraction

Catalog fit and bathroom-layout suggestions share a single saved extraction of the latest construction PDF for all current project rooms. Opening another room, another item, or another server instance reads the saved result instead of resubmitting the PDF. The first extraction keeps the full PDF so plans, elevations and fixture schedules remain available together.

The cache lives in the existing private `spec_completion_reviews.report.catalog_fit_checks` JSON. No schema or environment change is required. The key includes project ID, document ID/revision/path/size/title, the sorted room IDs and names, target labels and extraction version. Changes to selected products do not invalidate extracted document facts; those selections are still checked live against the correct room's cached requirements.

An optimistic database claim is saved before the paid request. Concurrent openings join that job. Polling only retrieves its existing background response. Failures, expired jobs and incomplete room mappings stay unavailable, with no automatic paid retries. The existing catalog Retry action can explicitly restart an unavailable shared job. Successful legacy room results remain usable without paying to migrate them.

Every supplied room must be returned exactly once. Requirements retain the existing exact-object, explicit-specification, high-confidence, original-page, unit and conflicting-callout validation. Bathroom absence still requires a complete proposed layout with a supported original-page citation. Public room responses expose only that room's requirements, after the existing staff/project/room authorization. Original PDFs and project selections remain unchanged.

The extraction uses the existing pinned Sol model, default service tier and token-counting cost ceiling. One shared extraction reserves the completion output budget because it covers all rooms; this is a per-request estimate, not an account-wide spending cap. Incomplete output is rejected rather than silently dropping rooms. Projects over 100 rooms fail closed.

Comprehensive Spec Book completion reviews still run separately when explicitly requested: their quantities, missing selections and current-product comparisons are different from catalog fit. This change reduces repeated room/layout extraction, not every AI operation in Studio.

Verification: catalog fit server tests cover concurrent cross-room reuse, shared layout reuse, background polling, document/room invalidation, unchanged-product reuse, legacy results, private review preservation, exact room mapping and no automatic retries. Layout route tests retain active staff and assigned-project access checks. Model cost guard tests remain unchanged.
