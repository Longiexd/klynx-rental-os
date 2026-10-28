"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { FileCheck2, Printer, CheckCircle2 } from "lucide-react";
import { useFeatures } from "@/components/providers/FeaturesProvider";
import { apiFetch } from "@/lib/api";
import { useKlynxUI } from "@/components/providers/UIProvider";

type TrackedDocument = {
  id: number | null; kind: string; label: string; filename: string | null;
  status: "missing" | "uploaded" | "verified" | "expired";
  number: string; expiry_date: string | null; verified: boolean; optional?: boolean;
  nationality?: string; birth_date?: string | null;
  reminder_date?: string | null; valid_from?: string | null; payment_confirmed?: boolean;
};
type Checklist = { documents: TrackedDocument[]; ready: boolean };
const input = "w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-text";
const button = "rounded-lg border border-border px-3 py-2 text-sm text-text hover:bg-surface-secondary disabled:opacity-50";

type DriverProfile = {active: boolean; name: string; phone: string; address: string; nationality: string; birth_date: string | null; license_issued: string; fee_reviewed: boolean};
type DriverStatus = Checklist & {profile: DriverProfile | null; fee_status?: "check_fee" | "invoice_pending" | "included"; rental_documents: TrackedDocument[]};
const coloredButton = button.replace("border-border", "").replace("text-text", "");
const saveButton = `${coloredButton} border-[var(--status-available-border)] bg-[var(--status-available-bg)] text-[var(--status-available-text)]`;
const reviewButton = `${coloredButton} border-[var(--status-rented-border)] bg-[var(--status-rented-bg)] text-[var(--status-rented-text)]`;

export type PaperworkStatus = { additional_driver?: DriverStatus; rental_documents?: TrackedDocument[]; documents_ready: boolean; contract_current: boolean; contract_ready: boolean; contract_id: number | null; snapshot_ids: number[]; details: Record<string, string> };
type Template = { mode: "basic" | "image"; background: string | null; mime?: string; terms: string; positions: Record<string, { x: number; y: number; width: number; size: number }>; fields: Record<string, string> };

async function encodedFile(file: File) {
  if (file.size > 600 * 1024) throw new Error("Compress the scan to 600 KiB or less.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

export function missingDriverDocumentsMessage(driverActive: boolean, driverReady: boolean | undefined, locale: string) {
  const additionalDriverMissing = driverActive && driverReady === false;
  if (locale === "fr") {
    return additionalDriverMissing
      ? "Les documents du conducteur principal ou les documents du conducteur supplémentaire sont manquants, non vérifiés ou expirés."
      : "Les documents du conducteur principal sont manquants, non vérifiés ou expirés.";
  }
  return additionalDriverMissing
    ? "Main-driver documents or the additional driver's identity/licence are missing, unverified or expired."
    : "Main-driver documents are missing, unverified or expired.";
}

export function PaperworkPanel({ rentalId, customerId, confirmed, collected, status, refresh, editBooking }: {
  rentalId: number; customerId: number; confirmed: boolean; collected: boolean; status: PaperworkStatus | null; refresh: () => Promise<void>; editBooking: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const [template, setTemplate] = useState<Template | null>(null);
  const [selectedField, setSelectedField] = useState("customer");
  const [editedDetails, setDetails] = useState<Record<string, string> | null>(null);
  const details = Object.fromEntries(Object.entries({...status?.details, ...editedDetails})
    .filter(([key]) => !["driver", "driver_identity", "driver_license"].includes(key)));
  const [addingDriver, setAddingDriver] = useState(false);
  const driver = status?.additional_driver;
  const profile = driver?.profile;
  const driverActive = Boolean(profile?.active);
  const { locale, t } = useKlynxUI();

  async function saveDriver(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const values = Object.fromEntries(["name", "phone", "address", "license_issued"].map(key => [key, String(fields.get(key) || "").trim()]));
    await perform(async () => {
      await apiFetch(`/sales/${rentalId}/additional-driver`, {method: "PUT", body: JSON.stringify({...profile, ...values, active: true})});
      setAddingDriver(false);
    });
  }

  async function perform(operation: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await operation(); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Paperwork could not be saved."); }
    finally { pending.current = false; setBusy(false); }
  }

  function openContract() {
    if (pending.current) return;
    const tab = window.open("about:blank", "_blank");
    if (!tab) { setError("Allow pop-ups to print the contract."); return; }
    tab.opener = null;
    void perform(async () => {
      try {
        const result = collected
          ? await apiFetch<{ html: string }>(`/sales/${rentalId}/contract`)
          : await apiFetch<{ html: string }>(`/sales/${rentalId}/contract/prepare`, { method: "POST", body: JSON.stringify({ details }) });
        const url = URL.createObjectURL(new Blob([result.html], { type: "text/html;charset=utf-8" }));
        tab.location.href = url; setTimeout(() => URL.revokeObjectURL(url), 300000);
      } catch (err) { tab.close(); throw err; }
    });
  }

  return <section id="paperwork" className="mt-6 scroll-mt-5 rounded-xl border border-border bg-surface p-5">
    <h2 className="font-semibold text-text">Paperwork before handing over the keys</h2>
    <p className="mt-2 text-sm text-text-secondary">1. Review identity and licence. 2. Prepare and print the contract. 3. Confirm it is ready, then validate actual pickup.</p>
    {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    <DocumentsPanel key={customerId} owner="customers" recordId={customerId} rentalId={rentalId} rentalCopies={status?.rental_documents}
      readOnly={collected} onChanged={() => void refresh().catch(err => setError(String(err)))} />
    {!collected && !driverActive && !addingDriver && <button data-i18n-ignore="true" className={`${button} mt-3 text-text-secondary`} disabled={busy} onClick={() => setAddingDriver(true)}>{locale === "fr" ? "Documents du conducteur supplémentaire (facultatif)" : "Additional-driver documents (optional)"}</button>}
    {(driverActive || addingDriver) && <details key={driverActive ? "saved-driver" : "new-driver"} open={addingDriver || undefined} className="mt-4 rounded-lg border border-border p-4">
      <summary className="cursor-pointer font-medium text-text">Additional driver{profile?.name ? ` · ${profile.name}` : ""}<span data-i18n-ignore="true" className={`ml-2 text-xs ${!driverActive ? "text-muted" : driver?.ready ? "text-[var(--status-available-text)]" : "text-danger"}`}>{!driverActive ? (locale === "fr" ? "Facultatif" : "Optional") : driver?.ready ? (locale === "fr" ? "Documents vérifiés" : "Documents verified") : (locale === "fr" ? "Identité et permis requis" : "Identity and licence required")}</span></summary>
      <p className="mt-2 text-xs text-text-secondary">This driver’s details and private scans belong only to this rental’s paperwork and contract.</p>
      {!collected && <form key={JSON.stringify(profile)} onSubmit={event => void saveDriver(event)} className="mt-3 grid gap-3 sm:grid-cols-2">
        {Object.entries({name: "Name and surname", phone: "Phone (optional)", address: "Address (optional)", license_issued: "Licence issue date (optional)"}).map(([key, label]) => <label key={key} className="text-sm text-text">{label}<input name={key} required={key === "name"} maxLength={key === "phone" || key === "license_issued" ? 100 : 250} defaultValue={profile?.[key as keyof DriverProfile] as string || ""} className={input} /></label>)}
        <div className="flex flex-wrap gap-2 sm:col-span-2"><button className={saveButton} disabled={busy} type="submit">Save additional driver</button><button className={button} disabled={busy} type="button" onClick={() => {
          if (!driverActive) { setAddingDriver(false); return; }
          void perform(async () => { await apiFetch(`/sales/${rentalId}/additional-driver`, {method: "PUT", body: JSON.stringify({...profile, active: false})}); });
        }}>{driverActive ? "Remove additional driver" : "Cancel"}</button></div>
      </form>}
      {driverActive && <>
        <DocumentsPanel key={`driver-${rentalId}-${profile?.name}`} owner="sales" recordId={rentalId} rentalId={rentalId} additionalDriver readOnly={collected} rentalCopies={driver?.rental_documents} onChanged={() => void refresh().catch(err => setError(String(err)))} />
        {!collected && driver?.fee_status !== "included" && !profile?.fee_reviewed && <div role="status" className="mt-3 rounded-lg border border-[var(--status-reserved-border)] bg-[var(--status-reserved-bg)] p-3 text-sm text-[var(--status-reserved-text)]">
          <p>{driver?.fee_status === "invoice_pending" ? "Additional-driver fee is on the quotation. Generate or update the invoice for this added service." : "Does your agency charge for an additional driver? Add OPT-CDSUPP to the quotation and invoice if applicable."}</p>
          <div className="mt-2 flex flex-wrap gap-2"><button className={reviewButton} disabled={busy} onClick={editBooking}>Review quotation / fee</button><button className={button} disabled={busy} onClick={() => void perform(async () => {
            await apiFetch(`/sales/${rentalId}/additional-driver`, {method: "PUT", body: JSON.stringify({...profile, fee_reviewed: true})});
          })}>{driver?.fee_status === "invoice_pending" ? "Fee reviewed" : "No additional fee applies"}</button></div>
        </div>}
      </>}
    </details>}
    <div className="mt-5 rounded-xl border border-border bg-surface-secondary p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-semibold text-text"><FileCheck2 size={20} className="text-pink-ink" aria-hidden="true" />Rental contract</h3>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${status?.contract_ready ? "bg-lime/10 text-lime-ink" : "bg-surface text-text-secondary"}`}>
          {!confirmed ? t("Awaiting booking confirmation") : status?.contract_ready ? "Ready for pickup" : !status ? "Checking paperwork…" : !status.documents_ready ? "Documents to complete" : status.contract_current ? "Awaiting print confirmation" : "Ready to generate"}
        </span>
      </div>
      <p data-i18n-ignore={status && !status.documents_ready ? "true" : undefined} className={`mt-1 text-sm ${status?.contract_ready ? "text-[var(--status-available-text)]" : status && !status.documents_ready ? "text-danger" : "text-text-secondary"}`}>
        {!confirmed ? t("Record the agreed payment and use Confirm booking before preparing the rental contract.") : !status ? "Checking paperwork…" : !status.documents_ready ? missingDriverDocumentsMessage(driverActive, driver?.ready, locale) : status.contract_ready ? "Contract ready. You can hand over the keys at actual pickup." : status.contract_current ? "Contract prepared. Print/save it and confirm below." : "Prepare the contract using the verified documents."}
      </p>
      <ol className="mt-4 grid gap-2 text-xs sm:grid-cols-3" aria-label="Contract preparation">
        {[["Verify documents", status?.documents_ready], ["Generate contract", status?.contract_current], ["Confirm printing", status?.contract_ready]].map(([label, done], index) => <li key={String(label)} className={`flex items-center gap-2 ${done ? "text-lime-ink" : "text-text-secondary"}`}><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface">{done ? <CheckCircle2 size={15} aria-hidden="true" /> : index + 1}</span>{t(String(label))}</li>)}
      </ol>
      {!collected && <details className="mt-4 border-t border-border pt-3 text-sm text-text-secondary"><summary className="cursor-pointer">Optional contract details</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">
        {Object.entries({birth_date: "Date of birth", nationality: "Nationality", license_issued: "Licence issue date", deposit: "Security deposit (caution)", fuel: "Pickup fuel", notes: "Contract notes"}).map(([key, label]) => <label key={key}>{label}<input className={input} maxLength={key === "notes" ? 2000 : 250} value={details[key] || ""} onChange={event => setDetails(previous => ({...previous, [key]: event.target.value}))} /></label>)}
      </div></details>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button className={`${button} inline-flex items-center gap-2 border-lime/40 bg-lime/15 font-semibold text-lime-ink`} disabled={busy || !confirmed || (!collected && !status?.documents_ready) || (collected && !status?.contract_id)} title={!confirmed ? t("Confirm the booking before preparing its contract.") : undefined} onClick={openContract}><Printer size={16} aria-hidden="true" />{busy ? "Working…" : collected ? "View / print saved contract" : "Prepare / Print rental contract"}</button>
        {!collected && status?.contract_current && !status.contract_ready && <button className={`${button} bg-lime/15`} disabled={busy} onClick={() => void perform(async () => {
          await apiFetch(`/sales/${rentalId}/contract/printed`, {method: "POST", body: JSON.stringify({contract_id: status.contract_id})});
        })}>I printed / saved this contract</button>}
      </div>
    </div>
    {!collected && <details className="mt-4 text-sm text-text-secondary" onToggle={event => {
      if (event.currentTarget.open && !template) void perform(async () => { setTemplate(await apiFetch<Template>(`/sales/${rentalId}/contract/template`)); });
    }}><summary className="cursor-pointer font-medium text-text">Company contract template · setup once</summary>
      <p className="mt-2">Use a straight blank A4 portrait scan or a Canva PNG/JPEG export (600 KiB maximum). Select each field and click its blank position. This company template applies to future contracts; saved rental contracts stay unchanged.</p>
      {template && <div className="mt-3 space-y-3">
        <label>Template style<select className={input} value={template.mode} onChange={event => setTemplate({...template, mode: event.target.value as Template["mode"]})}><option value="basic">Basic bilingual form</option><option value="image">Scanned / Canva form</option></select></label>
        {template.mode === "image" && <>
          <label>Blank form image<input type="file" accept="image/png,image/jpeg" className={input} disabled={busy} onChange={event => {
            const file = event.target.files?.[0]; if (file) void perform(async () => setTemplate({...template, background: await encodedFile(file), mime: file.type, positions: {}}));
          }} /></label>
          <label>Field to place<select className={input} value={selectedField} onChange={event => setSelectedField(event.target.value)}>{Object.entries(template.fields).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          {template.background && <div className="relative aspect-[210/297] w-full max-w-xl cursor-crosshair border border-border bg-white text-black" role="img" aria-label="Contract template field placement" onClick={event => {
            const rect = event.currentTarget.getBoundingClientRect(); const x = Math.min(75, Math.max(0, (event.clientX - rect.left) / rect.width * 100));
            const y = Math.min(97, Math.max(0, (event.clientY - rect.top) / rect.height * 100));
            setTemplate({...template, positions: {...template.positions, [selectedField]: {x, y, width: 25, size: 10}}});
          }}>
            {/* A data image is restricted to the upload's bounded PNG/JPEG payload. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`data:${template.mime || "image/png"};base64,${template.background}`} alt="Blank agency contract" className="absolute inset-0 h-full w-full" />
            {Object.entries(template.positions).map(([key, position]) => <span key={key} className="pointer-events-none absolute overflow-hidden bg-yellow-100/90 text-[10px]" style={{left: `${position.x}%`, top: `${position.y}%`, width: `${position.width}%`}}>{template.fields[key]}</span>)}
          </div>}
          <div className="grid gap-2 sm:grid-cols-2">{Object.entries(template.positions).map(([key, position]) => <div key={key} className="rounded border border-border p-2">
            <p>{template.fields[key]} <button className="text-danger underline" onClick={() => { const positions = {...template.positions}; delete positions[key]; setTemplate({...template, positions}); }}>Remove</button></p>
            {(["x", "y", "width", "size"] as const).map(property => <label className="mr-2 inline-flex items-center gap-1" key={property}>{property}<input aria-label={`${template.fields[key]} ${property}`} type="number" step={property === "size" ? 1 : 0.1} className="w-16 rounded border border-border bg-surface-secondary p-1 text-text" value={position[property]} onChange={event => setTemplate({...template, positions: {...template.positions, [key]: {...position, [property]: Number(event.target.value)}}})} /></label>)}
          </div>)}</div>
        </>}
        <label>Company conditions (plain text; printed on the following page)<textarea className={input} maxLength={12000} value={template.terms} onChange={event => setTemplate({...template, terms: event.target.value})} /></label>
        <button className={button} disabled={busy} onClick={() => void perform(async () => { await apiFetch(`/sales/${rentalId}/contract/template`, {method: "PUT", body: JSON.stringify(template)}); })}>Save company template</button>
      </div>}
    </details>}
  </section>;
}

function EnabledDocumentsPanel({ owner, recordId, onChanged, rentalId, rentalCopies, readOnly = owner === "sales", additionalDriver = false }: {
  owner: "customers" | "cars" | "sales"; recordId: number; onChanged?: () => void; rentalId?: number;
  rentalCopies?: TrackedDocument[]; readOnly?: boolean; additionalDriver?: boolean;
}) {
  // Driver scans reuse the same document workflow, scoped to the rental instead of a CRM contact.
  const editable = !readOnly;
  const { locale } = useKlynxUI();
  const identityOwner = owner === "customers" || additionalDriver;
  const path = additionalDriver ? `/sales/${recordId}/additional-driver/documents` : `/${owner}/${recordId}/documents`;
  const copyPath = `/sales/${rentalId}/${additionalDriver ? "additional-driver/copies" : "documents"}`;
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [revision, setRevision] = useState(0);
  const [identity, setIdentity] = useState<{ path: string; kind: string } | null>(null);
  const hasCopies = Boolean(rentalCopies?.some(document => document.id));
  const displayed = readOnly && hasCopies ? {documents: rentalCopies!, ready: true} : checklist;
  const identities = displayed?.documents.filter(document => document.kind === "cin" || document.kind === "passport") || [];
  const identityKind = (identity?.path === path ? identity.kind : null)
    || identities.find(document => document.status === "verified" && document.number.trim())?.kind
    || identities.find(document => document.id)?.kind || "cin";

  useEffect(() => {
    let active = true;
    if (readOnly && hasCopies) return;
    apiFetch<Checklist>(path).then(data => { if (active) setChecklist(data); })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : "Documents could not load."); });
    return () => { active = false; };
  }, [path, revision, readOnly, hasCopies]);

  async function save(event: FormEvent<HTMLFormElement>, document: TrackedDocument) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    const form = event.currentTarget;
    const fields = new FormData(form);
    const file = fields.get("file") as File | null;
    const number = String(fields.get("number") || "").trim();
    const expiry_date = String(fields.get("expiry_date") || "") || null;
    const identityFields = identityOwner && (document.kind === "cin" || document.kind === "passport")
      ? {nationality: String(fields.get("nationality") || "").trim(), birth_date: String(fields.get("birth_date") || "") || null} : {};
    const fleetFields = owner === "cars" ? {valid_from: String(fields.get("valid_from") || "") || null, payment_confirmed: fields.get("payment_confirmed") === "on"} : {};
    type SaveResult = {fleet_sync?: {linked?: boolean; state_synced?: boolean; crm_warning?: string}};
    try {
      let result: SaveResult;
      if (file?.size) {
        if (file.size > 600 * 1024) throw new Error("Compress the document to 600 KiB or less before uploading.");
        const content = await encodedFile(file);
        result = await apiFetch<SaveResult>(path, { method: "POST", body: JSON.stringify({ kind: document.kind, filename: file.name,
          content, number, expiry_date, ...identityFields, ...fleetFields }) });
        setNotice("Document uploaded. Review it, then mark it verified. Earlier versions remain in Odoo.");
      } else if (document.id) {
        result = await apiFetch<SaveResult>(`${path}/${document.id}`, { method: "PATCH", body: JSON.stringify({ number, expiry_date,
          verified: fields.get("verified") === "on", ...identityFields, ...fleetFields }) });
        setNotice("Document checklist updated.");
      } else throw new Error("Choose a document to upload first.");
      if (result.fleet_sync?.linked === false) setError(locale === "fr"
        ? "Document enregistré ; la liaison au contrat Odoo a échoué. Réessayez depuis le suivi du parc."
        : "Document saved; Odoo contract linking failed. Retry from Fleet care.");
      if (result.fleet_sync?.state_synced === false) setError(locale === "fr" ? "Document enregistré ; l’état du véhicule n’a pas pu être actualisé. Actualisez le suivi du parc." : "Document saved; vehicle state could not sync. Refresh Fleet care.");
      if (result.fleet_sync?.crm_warning) setError(result.fleet_sync.crm_warning);
      // A successful save is kept even if the following refresh fails.
      form.reset(); setChecklist(null); setRevision(value => value + 1); onChanged?.();
    } catch (err) { setError(err instanceof Error ? err.message : "Document could not be saved."); }
    finally { pending.current = false; setBusy(false); }
  }

  async function download(document: TrackedDocument, rentalCopy = false) {
    if (pending.current || !document.id) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const result = await apiFetch<{ content: string; mime: string; filename: string }>(`${rentalCopy ? copyPath : path}/${document.id}/download`);
      const bytes = Uint8Array.from(atob(result.content), character => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: result.mime }));
      const link = window.document.createElement("a"); link.href = url; link.download = result.filename;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) { setError(err instanceof Error ? err.message : "Document could not be downloaded."); }
    finally { pending.current = false; setBusy(false); }
  }

  return <section className="mt-6 rounded-xl border border-border bg-surface p-5" aria-label={additionalDriver ? "Additional driver documents" : owner === "sales" ? "Rental document copies" : owner === "customers" ? "Customer documents" : "Vehicle documents"}>
    <h2 className="font-semibold text-text">{additionalDriver ? "Additional driver documents" : identityOwner ? "Identity & driving licence" : owner === "sales" ? "Rental documents" : "Vehicle documents"}</h2>
    <p className="mt-1 text-xs text-text-secondary">{additionalDriver ? "Private scans are stored with this rental, with a separate copy preserved when the contract is prepared." : owner === "customers" ? "Originals are kept privately on the client’s Odoo contact for later rentals; contract preparation preserves separate copies with this rental." : owner === "sales" ? "Private copies are archived on this Odoo booking; updating the contact does not replace them." : "Documents and expiry dates are stored privately on this Odoo Fleet vehicle."}</p>
    <p className={`mt-1 text-sm ${displayed?.ready ? "text-[var(--status-available-text)]" : "text-muted"}`}>
      {!displayed ? "Loading document checklist…" : readOnly ? (hasCopies ? "Review the documents preserved with this rental contract." : "Review the current documents. This rental has no saved document copies.") : displayed.ready ? (identityOwner ? "Identity and licence verified." : "Vehicle documents verified.")
        : owner === "cars" ? "Review missing, unverified or expired vehicle documents." : "Review missing, unverified or expired documents before pickup."}
    </p>
    {error && <p role="alert" className="mt-3 text-sm text-[var(--status-danger-text)]">{error} <button className={button} disabled={busy} onClick={() => { setError(""); setRevision(value => value + 1); }}>Refresh</button></p>}
    {notice && <p role="status" className="mt-3 text-sm text-text">{notice}</p>}
    <div className="mt-3 grid gap-2">
      {displayed?.documents.filter(document => readOnly && !identityOwner ? document.id : !identityOwner || !["cin", "passport"].includes(document.kind) || document.kind === identityKind).map(document => <details key={`${identityOwner && ["cin", "passport"].includes(document.kind) ? "identity" : document.kind}-${revision}`} className={`group rounded-lg border ${editable && !(document.optional && !document.id) && ["missing", "expired"].includes(document.status) ? "border-[var(--status-danger-border)] bg-[var(--status-danger-bg)]" : "border-border"}`}>
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 p-3 text-sm text-text">
          <span className="flex items-center gap-2 font-medium"><span aria-hidden="true" className="text-lg transition-transform group-open:rotate-90">›</span>{identityOwner && ["cin", "passport"].includes(document.kind) ? "Identity · CIN / Passport" : document.label}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${document.optional && !document.id ? "bg-surface-secondary text-text-secondary" : document.status === "verified" ? "bg-[var(--status-available-bg)] text-[var(--status-available-text)]" : ["missing", "expired"].includes(document.status) ? "bg-[var(--status-danger-bg)] text-[var(--status-danger-text)]" : "bg-[var(--status-reserved-bg)] text-[var(--status-reserved-text)]"}`}>{document.optional && !document.id ? "Optional" : document.status === "uploaded" ? "Needs review" : document.status}{identityOwner && ["cin", "passport"].includes(document.kind) && document.id ? ` · ${document.label}` : ""}</span>
        </summary>
        <form key={`${document.kind}-${document.id}-${revision}`} onSubmit={event => void save(event, document)} className="border-t border-border p-3">
        {editable && <p className="text-xs text-text-secondary">PDF, PNG or JPEG · maximum 600 KiB. Uploads require agent verification.</p>}
        {editable && <fieldset disabled={busy} className="mt-3 grid gap-3 sm:grid-cols-2">
          {identityOwner && ["cin", "passport"].includes(document.kind) && <label className="text-sm text-text sm:col-span-2">Identity type<select className={`${input} mt-1 max-w-sm`} value={identityKind} onChange={event => setIdentity({path, kind: event.target.value})}>{identities.map(item => <option key={item.kind} value={item.kind}>{item.label}{item.id ? ` · ${item.status}` : ""}</option>)}</select></label>}
          <label className="text-sm text-text">{identityOwner && ["cin", "passport"].includes(document.kind) ? "CIN / Passport number" : "Document number"}<input name="number" maxLength={100} defaultValue={document.number} className={input} /></label>
          {identityOwner && ["cin", "passport"].includes(document.kind) && <>
            <label className="text-sm text-text">Nationality (optional)<input name="nationality" maxLength={100} defaultValue={document.nationality || ""} className={input} /></label>
            <label className="text-sm text-text">Date of birth (optional)<input name="birth_date" type="date" defaultValue={document.birth_date || ""} className={input} /></label>
          </>}
          <label className="text-sm text-text">{owner === "cars" && ["insurance", "technical_inspection", "vignette"].includes(document.kind) ? "Expiry date" : "Expiry date (optional)"}<input required={owner === "cars" && ["insurance", "technical_inspection", "vignette"].includes(document.kind)} name="expiry_date" type="date" defaultValue={document.expiry_date || ""} className={input} /></label>
          {owner === "cars" && <label data-i18n-ignore="true" className="text-sm text-text">{locale === "fr" ? "Début de validité (si applicable)" : "Valid from (if applicable)"}<input name="valid_from" type="date" defaultValue={document.valid_from || ""} className={input} /></label>}
          {owner === "cars" && ["insurance", "vignette"].includes(document.kind) && <label data-i18n-ignore="true" className="flex items-center gap-2 text-sm text-text"><input name="payment_confirmed" type="checkbox" defaultChecked={document.payment_confirmed} />{locale === "fr" ? "Paiement / couverture en vigueur contrôlé" : "Payment / active coverage checked"}</label>}
          {owner === "cars" && document.reminder_date && <p data-i18n-ignore="true" className="self-end text-xs text-text-secondary">{locale === "fr" ? `Renouvellement à prévoir dès le ${document.reminder_date} · un mois avant la date de fin.` : `Renewal window starts ${document.reminder_date} · one month before expiry.`}</p>}
          <label className="text-sm text-text sm:col-span-2">{document.id ? "Replace scan (optional)" : "Upload scan"}<input name="file" type="file" accept="application/pdf,image/png,image/jpeg" className={input} /></label>
          {document.id && <label className="flex items-center gap-2 text-sm text-text"><input name="verified" type="checkbox" defaultChecked={document.verified} />Verified by agent</label>}
          <button className={`${saveButton} justify-self-start`} type="submit">{busy ? "Please wait…" : "Save document"}</button>
        </fieldset>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {editable && rentalCopies?.some(copy => copy.kind === document.kind && copy.id) && <select name="review_source" aria-label="Document review source" className={`${input} max-w-xs`} defaultValue={document.id ? "original" : "rental"}><option value="original" disabled={!document.id}>Current document</option><option value="rental">Copy saved with this rental</option></select>}
          <button disabled={busy || !document.id && !rentalCopies?.some(copy => copy.kind === document.kind && copy.id)} className={reviewButton} type="button" onClick={event => {
            const source = event.currentTarget.form?.elements.namedItem("review_source") as HTMLSelectElement | null;
            const copy = rentalCopies?.find(item => item.kind === document.kind);
            void download(source?.value === "rental" && copy ? copy : document, Boolean(readOnly && hasCopies || source?.value === "rental" && copy));
          }}>Download / review</button>
        </div>
      </form></details>)}
    </div>
  </section>;
}

export default function DocumentsPanel(props: Parameters<typeof EnabledDocumentsPanel>[0]) {
  const features = useFeatures();
  if (props.owner === "cars" && !features?.fleet_care) return null;
  return <EnabledDocumentsPanel {...props} />;
}
