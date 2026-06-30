import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
});

function TermsPage() {
  return (
    <main className="min-h-screen bg-background text-ink">
      <section className="mx-auto max-w-3xl px-6 py-16">
        <Link to="/" className="text-sm text-muted-foreground hover:text-ink">
          MERAV Studio
        </Link>
        <div className="eyebrow mt-10 mb-4">Terms of Use</div>
        <h1 className="font-display text-5xl md:text-6xl">MERAV Studio Terms of Use</h1>
        <p className="mt-6 text-sm text-muted-foreground">Last updated: June 30, 2026</p>

        <div className="mt-10 space-y-8 text-base leading-7 text-muted-foreground">
          <section>
            <h2 className="font-display text-3xl text-ink">Use of MERAV Studio</h2>
            <p className="mt-3">
              MERAV Studio is provided for use by Merav Interiors and authorized users to manage interior design
              projects, client communication, approvals, product selections, invoices, timelines, procurement, and
              related business workflows.
            </p>
          </section>

          <section>
            <h2 className="font-display text-3xl text-ink">Authorized Access</h2>
            <p className="mt-3">
              Users may access MERAV Studio only with an account provided or approved by Merav Interiors. Users are
              responsible for keeping login information confidential and for using Studio only for authorized project
              and business purposes.
            </p>
          </section>

          <section>
            <h2 className="font-display text-3xl text-ink">Project and Financial Data</h2>
            <p className="mt-3">
              MERAV Studio may include client information, invoices, payment status, product details, design boards,
              spec books, construction documents, and other project records. Users agree to handle this information
              carefully and only for the purposes of completing authorized project work.
            </p>
          </section>

          <section>
            <h2 className="font-display text-3xl text-ink">Connected Services</h2>
            <p className="mt-3">
              MERAV Studio may connect with third-party services such as QuickBooks, Stripe, Supabase, and Vercel to
              support invoicing, payment tracking, accounting sync, hosting, storage, and application operations.
            </p>
          </section>

          <section>
            <h2 className="font-display text-3xl text-ink">Limitations</h2>
            <p className="mt-3">
              MERAV Studio is provided as a business operations tool. While we work to keep records accurate and
              available, users should review important financial, design, procurement, and project information before
              relying on it for final decisions.
            </p>
          </section>

          <section>
            <h2 className="font-display text-3xl text-ink">Changes</h2>
            <p className="mt-3">
              Merav Interiors may update these terms as Studio evolves. Continued use of MERAV Studio means the user
              accepts the current terms.
            </p>
          </section>

          <section>
            <h2 className="font-display text-3xl text-ink">Contact</h2>
            <p className="mt-3">
              Questions about these terms can be directed to Merav Interiors at{" "}
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
