"use client";

import { ChevronRight, Mail, Phone, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

import AddCustomerModal from "@/components/customers/AddCustomerModal";

import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SearchInput } from "@/components/ui/SearchInput";

import { getInitials } from "@/lib/format";
import { API_URL, apiRequest } from "@/lib/api-config";

type Customer = {
  id: number;
  name: string;
  phone: string | false;
  email: string | false;
  mobile: string | false;
};

type CustomersResponse = {
  count: number;
  customers: Customer[];
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  async function loadCustomers() {
    try {
      setLoading(true);
      setError("");

      const response = await apiRequest(`${API_URL}/customers`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data: CustomersResponse = await response.json();

      setCustomers(Array.isArray(data.customers) ? data.customers : []);
    } catch (err) {
      console.error("Failed to load customers:", err);
      setError("Unable to load customer data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCustomers();
  }, []);

  const filteredCustomers = useMemo(() => {
    const query = search.toLowerCase().trim();

    if (!query) return customers;

    return customers.filter(
      (customer) =>
        customer.name?.toLowerCase().includes(query) ||
        String(customer.phone || "").toLowerCase().includes(query) ||
        String(customer.mobile || "").toLowerCase().includes(query) ||
        String(customer.email || "").toLowerCase().includes(query)
    );
  }, [customers, search]);

  return (
    <main className="mx-auto max-w-[1500px] p-5 sm:p-8">
      <PageHeader
        breadcrumb="Customers"
        title="Customers"
        subtitle="Manage customers, contact information and rental history."
        action={
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex h-9 items-center justify-center gap-2 rounded-lg bg-lime px-4 text-xs font-medium text-[#111113] shadow-glow-lime transition hover:bg-lime-dark"
          >
            <UserPlus size={14} />
            Add customer
          </button>
        }
      />

      {/* STATS */}
      <section className="mt-7 grid gap-3 sm:grid-cols-2">
        <StatCard
          icon={<Users size={15} />}
          label="Total customers"
          value={customers.length.toString()}
          detail="contacts"
          loading={loading}
        />

        <StatCard
          icon={<UserPlus size={15} />}
          label="Showing"
          value={filteredCustomers.length.toString()}
          detail="customers"
          tone="pink"
          loading={loading}
        />
      </section>

      {/* CUSTOMER TABLE */}
      <section className="mt-4">
        <Card>
          <CardHeader
            title="Customer directory"
            subtitle="Live customer data"
            action={
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search customers..."
                className="w-full sm:w-[260px]"
              />
            }
          />

          {loading && (
            <div className="p-10 text-center text-xs text-muted">
              Loading customers...
            </div>
          )}

          {!loading && error && (
            <div className="p-10 text-center text-xs text-danger">
              {error}
            </div>
          )}

          {!loading && !error && filteredCustomers.length === 0 && (
            <div className="p-6">
              <EmptyState
                icon={<Users />}
                title="No customers found"
                description={
                  search
                    ? "Try a different search term."
                    : "Add your first customer to get started."
                }
              />
            </div>
          )}

          {!loading && !error && filteredCustomers.length > 0 && (
            <>
            <div className="space-y-3 p-3 md:hidden">{filteredCustomers.map(customer => <Link key={customer.id} href={`/dashboard/customers/${customer.id}`} className="flex min-h-20 items-start gap-3 rounded-xl border border-border bg-surface p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-lime/10 text-xs font-semibold text-lime-ink">{getInitials(customer.name)}</span>
              <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold text-text">{customer.name}</p><p className="mt-1 truncate text-xs text-text-secondary">{customer.phone || customer.mobile || "—"}</p>{customer.email && <p className="mt-1 truncate text-xs text-muted">{customer.email}</p>}</div><ChevronRight size={18} className="shrink-0 text-muted"/>
            </Link>)}</div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[750px] text-left">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted">
                    <th className="px-5 py-3 font-medium">Customer</th>
                    <th className="px-5 py-3 font-medium">Phone</th>
                    <th className="px-5 py-3 font-medium">Mobile</th>
                    <th className="px-5 py-3 font-medium">Email</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>

                <tbody className="divide-y divide-border">
                  {filteredCustomers.map((customer) => (
                    <tr
                      key={customer.id}
                      className="group text-xs transition hover:bg-surface-secondary/50"
                    >
                      <td className="p-0">
                        <Link
                          href={`/dashboard/customers/${customer.id}`}
                          className="flex items-center gap-3 px-5 py-4"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-lime/10 text-[10px] font-semibold text-lime-ink">
                            {getInitials(customer.name)}
                          </div>

                          <div>
                            <div className="font-medium text-text">
                              {customer.name}
                            </div>
                            <div className="mt-0.5 text-[9px] text-muted">
                              ID #{customer.id}
                            </div>
                          </div>
                        </Link>
                      </td>

                      <td className="px-5 py-4 text-text-secondary">
                        <div className="flex items-center gap-2">
                          <Phone size={12} className="text-muted" />
                          {customer.phone || "—"}
                        </div>
                      </td>

                      <td className="px-5 py-4 text-text-secondary">
                        {customer.mobile || "—"}
                      </td>

                      <td className="px-5 py-4 text-text-secondary">
                        <div className="flex items-center gap-2">
                          <Mail size={12} className="text-muted" />
                          {customer.email || "—"}
                        </div>
                      </td>

                      <td className="px-5 py-4 text-right">
                        <Link
                          href={`/dashboard/customers/${customer.id}`}
                          className="inline-flex text-muted transition group-hover:text-lime-ink"
                        >
                          <ChevronRight size={15} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </Card>
      </section>

      {showCreate && (
        <AddCustomerModal
          apiUrl={API_URL}
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            setShowCreate(false);
            loadCustomers();
          }}
        />
      )}
    </main>
  );
}
