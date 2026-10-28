import { CalendarCheck, ClipboardList, FileCheck2, KeyRound, RotateCcw, ReceiptText, UserRound, Wallet } from "lucide-react";
import { useKlynxUI } from "@/components/providers/UIProvider";
import { formatCurrency } from "@/lib/format";

type JourneyProps = {
  editable: boolean; cancelled: boolean; confirmed: boolean;
  pickedUp: boolean; returned: boolean; customerPresent: boolean;
  requirementsReady: boolean; paymentReceived: boolean; fullyPaid: boolean;
  contractReady: boolean; paperworkLoading: boolean;
};

export default function BookingJourney(props: JourneyProps) {
  const { t } = useKlynxUI();
  const current = props.cancelled || props.returned ? -1 : props.pickedUp ? 7
    : props.editable ? 2 : !props.paymentReceived ? 3 : !props.confirmed ? 4
    : !props.contractReady ? 5 : 6;
  const steps = [
    { label: "Client", icon: UserRound, target: "booking", done: props.customerPresent, detail: props.customerPresent ? "Saved" : "To complete" },
    { label: "Requirements", icon: ClipboardList, target: "booking", done: props.requirementsReady, detail: props.requirementsReady ? "Saved" : "To complete" },
    { label: "Quotation", icon: ReceiptText, target: "quotation", done: !props.editable && !props.cancelled, detail: props.editable ? "To review" : props.cancelled ? "Cancelled" : "Confirmed" },
    { label: "Payment", icon: Wallet, target: "payments", done: props.paymentReceived, detail: props.fullyPaid ? "Paid" : props.paymentReceived ? "Deposit received" : "Awaiting payment" },
    { label: "Confirmation", icon: CalendarCheck, target: "booking", done: props.confirmed, detail: props.cancelled ? "Cancelled" : props.confirmed ? "Confirmed" : "To confirm" },
    { label: "Documents", icon: FileCheck2, target: "paperwork", done: props.contractReady, detail: props.paperworkLoading ? "Checking…" : props.contractReady ? "Ready" : "To complete" },
    { label: "Pickup", icon: KeyRound, target: "handover", done: props.pickedUp || props.returned, detail: props.pickedUp || props.returned ? "Completed" : "Upcoming" },
    { label: "Return", icon: RotateCcw, target: "return", done: props.returned, detail: props.returned ? "Completed" : "Upcoming" },
  ];
  return <nav aria-label={t("Booking progress")} className="mt-5 rounded-xl border border-border bg-surface p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-semibold text-text">{t("Booking journey")}</h2>
      <span className="text-sm text-text-secondary">{t(props.cancelled ? "Booking cancelled" : props.returned ? "Rental completed" : props.pickedUp ? "Return upcoming" : current === 5 ? "Documents to complete" : props.confirmed ? "Booking confirmed" : "Booking in progress")}</span>
    </div>
    <ol className="mt-6 flex snap-x gap-y-5 overflow-x-auto pb-2 sm:grid sm:grid-cols-4 sm:overflow-visible lg:grid-cols-8">
      {steps.map((step, index) => {
        const active = index === current;
        const color = active ? "text-pink-ink" : step.done ? "text-lime-ink" : "text-text-secondary";
        const Icon = step.icon;
        return <li key={step.label} aria-current={active ? "step" : undefined} className="relative w-24 shrink-0 snap-center text-center sm:w-auto sm:min-w-0">
          {index < steps.length - 1 && <span aria-hidden="true" className={`absolute left-[calc(50%+26px)] top-[25px] h-0.5 w-[calc(100%-52px)] ${index === 3 ? "sm:hidden lg:block" : ""} ${step.done && steps[index + 1].done ? "bg-lime" : "bg-border"}`} />}
          <a href={`#${step.target}`} className={`relative flex flex-col items-center gap-2 rounded-lg px-1 py-1 ${color}`}>
            <span className={`flex h-11 w-11 items-center justify-center rounded-full border ${active ? "border-pink/60 bg-pink/10 ring-4 ring-pink/5" : step.done ? "border-lime/40 bg-lime/10" : "border-border bg-surface-secondary"}`}><Icon size={19} aria-hidden="true" /></span>
            <span className="text-xs font-semibold">{t(step.label)}</span>
            <span className="text-[11px] text-text-secondary">{t(step.detail)}</span>
          </a>
        </li>;
      })}
    </ol>
  </nav>;
}

export function InvoiceSummary({ total, paid, outstanding, draft, credit }: { total: number; paid: number; outstanding: number; draft: boolean; credit: boolean }) {
  const { t } = useKlynxUI();
  const percent = total > 0 ? Math.min(100, Math.max(0, paid / total * 100)) : 0;
  return <div className="my-5">
    <dl className="grid grid-cols-2 gap-5 sm:grid-cols-3">
      {[["Total", total], ["Paid", paid], ["Outstanding", outstanding]].map(([label, value], index) => <div key={String(label)} className={`${index === 2 ? "col-span-2 border-t border-border pt-4 sm:col-span-1 sm:border-t-0 sm:pt-0" : ""} ${index > 0 ? "sm:border-l sm:border-border sm:pl-5" : ""}`}>
        <dt className="text-xs text-text-secondary">{t(String(label))}</dt>
        <dd className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${index === 2 && outstanding > 0 ? "text-[var(--status-reserved-text)]" : "text-text"}`}>{formatCurrency(Number(value))}</dd>
      </div>)}
    </dl>
    {!draft && !credit && total > 0 && <div className="mt-5">
      <div className="mb-2 flex justify-between gap-2 text-xs text-text-secondary"><span>{t("Payment progress")}</span><span>{Math.round(percent)}% {t("paid")}</span></div>
      <div role="progressbar" aria-label={t("Payment progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 overflow-hidden rounded-full bg-surface-secondary"><div className="h-full rounded-full bg-lime" style={{ width: `${percent}%` }} /></div>
    </div>}
  </div>;
}
