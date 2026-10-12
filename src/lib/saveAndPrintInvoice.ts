// Reserve the print window during the click so browsers allow it after saving.
export async function saveAndPrintInvoice<T>({
  html, fileName, save, onSaved,
}: {
  html: string;
  fileName: string;
  save: () => Promise<T | null>;
  onSaved: () => void;
}) {
  const target = window.open("", "_blank");
  if (!target) throw new Error("Allow popups to save and download the invoice PDF.");
  target.opener = null;
  target.document.body.textContent = "Saving invoice…";
  let saved: T;
  try {
    const result = await save();
    if (!result) throw new Error("Could not save the invoice. Please try again.");
    saved = result;
  } catch (error) {
    target.close();
    throw error;
  }
  // Close the creator after persistence, even if printing fails, to prevent duplicates.
  onSaved();
  try {
    if (target.closed) throw new Error("Print window closed");
    target.document.open();
    target.document.write(html);
    target.document.close();
    target.document.title = `${fileName}.pdf`;
    target.setTimeout(() => {
      target.focus();
      target.print();
    }, 350);
  } catch {
    target.close();
    throw new Error("Invoice saved. Download it from the saved invoice list to try again.");
  }
  return saved;
}
