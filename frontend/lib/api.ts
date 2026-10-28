import { API_URL, apiRequest } from "@/lib/api-config";


// ============================================================
// TYPES
// ============================================================

export interface Customer {
  id: number;
  partner_id: number;

  name: string;
  phone?: string | null;
  email?: string | null;

  // CRM
  crm_stage?: string | null;
  crm_stage_id?: number | null;

  salesperson?: string | null;
  salesperson_id?: number | null;

  lead_id?: number | null;
  lead_name?: string | null;

  description?: string | null;
  expected_revenue?: number;
  probability?: number;

  created?: string | null;
  updated?: string | null;

  // Rental
  rental_status?: string | null;

  // Sales
  sales_count?: number;
  sales_total?: number;
  sales_orders?: SalesOrder[];

  // Invoices
  invoice_count?: number;
  invoice_total?: number;
  outstanding_amount?: number;

  paid_invoices?: number;
  unpaid_invoices?: number;

  payment_status?: string;

  invoice_ids?: number[];
  invoices?: Invoice[];

  lead_history?: LeadHistory[];

  address?: {
    street?: string | null;
    street2?: string | null;
    city?: string | null;
    zip?: string | null;
    country?: string | null;
  };

  company_name?: string | null;
  vat?: string | null;
}


export interface SalesOrder {
  id: number;
  name: string;
  amount_total: number;
  state?: string;
  invoice_status?: string;
  date_order?: string;
  salesperson?: string | null;
  salesperson_id?: number | null;
}


export interface Invoice {
  id: number;
  name?: string;
  state?: string;
  move_type?: string;

  amount_total: number;
  amount_residual: number;

  payment_state?: string;

  invoice_date?: string | null;
  due_date?: string | null;

  origin?: string | null;
}


export interface LeadHistory {
  id: number;
  name: string;

  stage?: string | null;
  stage_id?: number | null;

  salesperson?: string | null;
  salesperson_id?: number | null;

  description?: string | null;

  expected_revenue?: number;
  probability?: number;

  created?: string | null;
}


export interface Lead {
  id: number;
  name: string;

  customer?: {
    id: number;
    name: string;
  } | null;

  phone?: string | null;
  email?: string | null;

  stage?: string | null;

  salesperson?: {
    id: number;
    name: string;
  } | null;

  expected_revenue?: number;

  created?: string | null;
}


export interface CreateCustomerData {
  name: string;
  phone?: string;
  email?: string;
  description?: string;
}


export interface CreateLeadData {
  name: string;
  phone?: string;
  email?: string;
  description?: string;
}


// ============================================================
// HELPER
// ============================================================

export async function apiFetch<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {

  const response = await apiRequest(
    `${API_URL}${endpoint}`,
    {
      ...options,

      headers: {
        "Content-Type": "application/json",
        ...(options?.headers || {}),
      },

      cache: "no-store",
    }
  );


  if (!response.ok) {

    let message =
      `API error: ${response.status}`;

    try {

      const error =
        await response.json();

      if (typeof error?.detail === "string") {
        message = error.detail;
      } else if (Array.isArray(error?.detail)) {
        message = error.detail.map((item: { msg?: string }) => item.msg || "Invalid input").join("; ");
      }

    } catch {
      // Ignore JSON parsing errors
    }

    throw new Error(message);
  }


  return response.json();
}


// ============================================================
// CUSTOMERS
// ============================================================

export async function getCustomers(): Promise<{
  count: number;
  customers: Customer[];
}> {

  return request("/customers");
}


export async function getCustomer(
  id: number
): Promise<Customer> {

  return request(
    `/customers/${id}`
  );
}


export async function createCustomer(
  data: CreateCustomerData
) {

  return request<{
    success: boolean;
    partner_id: number;
    lead_id: number;
  }>(
    "/customers",
    {
      method: "POST",

      body: JSON.stringify(data),
    }
  );
}


// ============================================================
// CRM LEADS
// ============================================================

export async function getLeads(): Promise<{
  count: number;
  leads: Lead[];
}> {

  return request(
    "/crm/leads"
  );
}


export async function createLead(
  data: CreateLeadData
) {

  return request<{
    success: boolean;
    lead_id: number;
  }>(
    "/crm/leads",
    {
      method: "POST",

      body: JSON.stringify(data),
    }
  );
}

const request = apiFetch;
