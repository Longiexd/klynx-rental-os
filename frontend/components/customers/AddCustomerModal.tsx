"use client";

import { AlertTriangle, Loader2, Mail, Phone, User, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-config";

// ============================================================
// TYPES
// ============================================================

type Match = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  is_customer: boolean;
};

type Props = {
  apiUrl: string;
  onClose: () => void;
  // Called after a customer is created OR an opportunity is
  // attached to an existing contact. partnerId lets the caller
  // navigate straight to the resulting customer if it wants to;
  // name is passed back too so callers don't need a second
  // lookup just to display it.
  onSuccess: (partnerId: number, name: string) => void;
  // Pre-fills the name field — used when this modal is opened
  // from an inline "create new customer" prompt elsewhere (e.g.
  // typed a name in the rental form that didn't match anyone).
  initialName?: string;
};

// ============================================================
// COMPONENT
// ============================================================

export default function AddCustomerModal({
  apiUrl,
  onClose,
  onSuccess,
  initialName = "",
}: Props) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [description, setDescription] = useState("");

  const [matches, setMatches] = useState<Match[]>([]);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ==========================================================
  // DUPLICATE CHECK (debounced as the user types the name)
  // ==========================================================

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    const query = name.trim();

    if (query.length < 2) {
      setMatches([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        setChecking(true);

        const response = await apiRequest(
          `${apiUrl}/customers/search?q=${encodeURIComponent(query)}`
        );

        if (!response.ok) {
          return;
        }

        const data = await response.json();
        setMatches(data.matches || []);
      } catch (err) {
        console.error("Duplicate check failed:", err);
      } finally {
        setChecking(false);
      }
    }, 350);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [name, apiUrl]);

  // ==========================================================
  // CREATE BRAND NEW CUSTOMER (partner + lead together)
  // ==========================================================

  async function handleCreateNew() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }

    try {
      setSubmitting(true);
      setError("");

      const response = await apiRequest(`${apiUrl}/customers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          description: description.trim() || null,
        }),
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();
      onSuccess(data.partner_id, name.trim());
    } catch (err) {
      console.error("Failed to create customer:", err);
      setError("Unable to create customer. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ==========================================================
  // ATTACH A NEW OPPORTUNITY TO AN EXISTING CONTACT
  // ==========================================================

  async function handleAttachToExisting(match: Match) {
    try {
      setSubmitting(true);
      setError("");

      const response = await apiRequest(`${apiUrl}/crm/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || match.name,
          phone: phone.trim() || match.phone || null,
          email: email.trim() || match.email || null,
          description: description.trim() || null,
          partner_id: match.id,
        }),
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      onSuccess(match.id, name.trim() || match.name);
    } catch (err) {
      console.error("Failed to attach opportunity:", err);
      setError("Unable to attach opportunity. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4">
      <div role="dialog" aria-modal="true" aria-label="New customer" className="klynx-form-sheet max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-surface p-5 shadow-2xl">
        {/* HEADER */}

        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-[Syne] text-sm font-semibold text-text">
            Add customer
          </h2>

          <button
            onClick={onClose}
            aria-label="Close"
            className="text-muted transition hover:text-text"
          >
            <X size={16} />
          </button>
        </div>

        {/* FORM */}

        <div className="space-y-3">
          <div className="relative">
            <User
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              className="h-9 w-full rounded-lg border border-border bg-surface-secondary pl-9 pr-3 text-xs text-text outline-none placeholder:text-muted focus:border-[#C8F065]/40"
            />
          </div>

          <div className="relative">
            <Phone
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone"
              className="h-9 w-full rounded-lg border border-border bg-surface-secondary pl-9 pr-3 text-xs text-text outline-none placeholder:text-muted focus:border-[#C8F065]/40"
            />
          </div>

          <div className="relative">
            <Mail
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="h-9 w-full rounded-lg border border-border bg-surface-secondary pl-9 pr-3 text-xs text-text outline-none placeholder:text-muted focus:border-[#C8F065]/40"
            />
          </div>

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Notes (optional)"
            rows={2}
            className="w-full resize-none rounded-lg border border-border bg-surface-secondary p-3 text-xs text-text outline-none placeholder:text-muted focus:border-[#C8F065]/40"
          />
        </div>

        {/* DUPLICATE SUGGESTION */}

        {checking && (
          <div className="mt-3 flex items-center gap-2 text-[11px] text-muted">
            <Loader2 size={12} className="animate-spin" />
            Checking existing contacts...
          </div>
        )}

        {!checking && matches.length > 0 && (
          <div className="mt-3 rounded-lg border border-[#F06AAA]/25 bg-[#F06AAA]/5 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle
                size={13}
                className="mt-0.5 shrink-0 text-pink-ink"
              />
              <p className="text-[11px] leading-relaxed text-pink-ink">
                {matches.length === 1 ? "A contact" : "Contacts"} matching
                this name already{" "}
                {matches.length === 1 ? "exists" : "exist"}. Attach a new
                opportunity instead of creating a duplicate?
              </p>
            </div>

            <div className="mt-2 space-y-1.5">
              {matches.map((match) => (
                <div
                  key={match.id}
                  className="flex items-center justify-between rounded-md border border-border bg-background px-2.5 py-2"
                >
                  <div>
                    <div className="text-[11px] font-medium text-text">
                      {match.name}
                    </div>
                    <div className="text-[10px] text-muted">
                      {match.is_customer
                        ? "Existing customer"
                        : "Contact, not yet a customer"}
                      {match.phone ? ` · ${match.phone}` : ""}
                    </div>
                  </div>

                  <button
                    disabled={submitting}
                    onClick={() => handleAttachToExisting(match)}
                    className="shrink-0 rounded-md border border-[#C8F065]/30 bg-[#C8F065]/10 px-2 py-1 text-[10px] font-medium text-lime-ink transition hover:bg-[#C8F065]/20 disabled:opacity-50"
                  >
                    Attach opportunity
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ERROR */}

        {error && (
          <div className="mt-3 rounded-lg border border-[#F06AAA]/30 bg-[#F06AAA]/5 px-3 py-2 text-[11px] text-pink-ink">
            {error}
          </div>
        )}

        {/* ACTIONS */}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="h-9 rounded-lg border border-border px-4 text-xs font-medium text-text-secondary transition hover:text-text"
          >
            Cancel
          </button>

          <button
            disabled={submitting || !name.trim()}
            onClick={handleCreateNew}
            className="flex h-9 items-center gap-2 rounded-lg bg-[#C8F065] px-4 text-xs font-medium text-[#09090B] transition hover:bg-[#d7ff80] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && <Loader2 size={12} className="animate-spin" />}
            {matches.length > 0 ? "Create new anyway" : "Create customer"}
          </button>
        </div>
      </div>
    </div>
  );
}
