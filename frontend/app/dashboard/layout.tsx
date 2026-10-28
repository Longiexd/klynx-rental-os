import React from "react";
import { hasSession } from "@/lib/backend-server";
import { redirect } from "next/navigation";

import OSLayout from "@/components/layout/OSLayout";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await hasSession())) {
    redirect("/login");
  }

  return <OSLayout>{children}</OSLayout>;
}
