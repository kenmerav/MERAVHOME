import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background text-ink">
      <section className="mx-auto max-w-3xl px-6 py-16">
        <Link to="/" className="text-sm text-muted-foreground hover:text-ink">
          MERAV Studio
        </Link>
        <div className="eyebrow mt-10 mb-4">Privacy Policy</div>
        <h1 className="font-display text-5xl md:text-6xl">MERAV Studio Privacy Policy</h1>
        <p className="mt-6 text-sm text-muted-foreground">Last updated: June 30, 2026</p>

        <div className="mt-10 space-y-8 text-base leading-7 text-muted-foreground">
          <section>
            <h2 className="font-display text-3xl text-ink">Overview</h2>
            <p className="mt-3">
              MERAV Studio is an internal studio platform used by Merav Interiors to manage interior design projects,
              client invoices, product procurement, approvals, timelines, spec books, and project documentation. This
              policy explains what information MERAV Studio collects, how it is used, and how it is protected.
            </p>
          </section>

          <section>
            <h2 className="font-display text-3xl text-ink">Information We Collect</h2>
            <p className="mt-3">
              MERAV Studio may store client names, email addresses, project addresses, project details, invoices,
              payment status, product selections, design documentation, uploaded files, and user account information.
              When QuickBooks is connected, MERAV Studio may access customer, invoice, payment, and related accounting
              information needed to keep Studio and QuickBooks records aligned.
            </p>
          </section>

          <section>
            <h2 className="font-display text-3xl text-ink">How We Use Information</h2>
            <p className="mt-3">
              Information is used to operate MERAV Studio, manage design projects, prepare and track invoices, sync
              approved financial records to QuickBooks, coordinate procurement, share approved project materials with
              clients and project partners, and support internal business workflows.
            </p>
          </section>

          <section>
            <h2 className="font-display text-3xl text-ink">Data Sharing</h2>
            <p className="mt-3">
              MERAV Studio does not sell personal data. Information is shared only with service providers needed to
              operate Studio, including hosting, database, storage, payment, and accounting providers such as Vercel,
              Supabase, Stripe, and QuickBooks.
            </p>
          </section>

          <section>
            <h2 className="font-display text-3xl text-ink">QuickBooks Connection</h2>
            <p className="mt-3">
              If QuickBooks is connected, MERAV Studio uses the connection only to read or create accounting records
              needed for customer matching, invoice syncing, and payment tracking. Disconnecting QuickBooks stops future
              syncing. Existing Studio records remain in Studio unless removed by an authorized administrator.
            </p>
          </section>

          <section>
            <h2 className="font-display text-3xl text-ink">Security</h2>
            <p className="mt-3">
              Access to MERAV Studio is limited to authorized users. Sensitive credentials are stored in server-side
              environment variables or secured database records and are not exposed in the browser.
            </p>
          </section>

          <section>
            <h2 className="font-display text-3xl text-ink">Contact</h2>
            <p className="mt-3">
              Questions about this policy can be directed to Merav Interiors at{" "}
              <a className="underline" href="mailto:katie@meravinteriors.com">
                katie@meravinteriors.com
              </a>
              .
            </p>
          </section>
        </div>
      </section>
    </main>
  );
}
