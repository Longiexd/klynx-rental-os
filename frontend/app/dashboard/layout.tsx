import React from "react";
import OSLayout from "@/components/layout/OSLayout";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <OSLayout>{children}</OSLayout>;
}