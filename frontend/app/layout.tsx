import "./globals.css";

import React from "react";
import type { Metadata, Viewport } from "next";
import RegisterServiceWorker from "@/components/RegisterServiceWorker";
import { FeaturesProvider } from "@/components/providers/FeaturesProvider";
import { UIProvider } from "@/components/providers/UIProvider";
import { Geist, Geist_Mono, Syne } from "next/font/google";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Klynx Rental OS",
  description: "Business Operating System for Car Rental Companies",

  manifest: "/manifest.webmanifest",

  icons: {
    icon: [
      {
        url: "/icons/xicon.png?v=20261011023149",
        type: "image/png",
      },
    ],
    shortcut: "/icons/xicon.png?v=20261011023149",
    apple: [
      {
        url: "/icons/icon-192.png?v=20261011",
        sizes: "192x192",
        type: "image/png",
      },
    ],
  },

  appleWebApp: {
    capable: true,
    title: "Klynx OS",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#09090B",
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('klynx-theme');var l=localStorage.getItem('klynx-locale');document.documentElement.dataset.theme=t==='light'?'light':'dark';document.documentElement.lang=l==='fr'?'fr':'en';}catch(e){}})();`,
          }}
        />
      </head>
      <body
        className={`${geist.variable} ${geistMono.variable} ${syne.variable} antialiased`}
      >
        <RegisterServiceWorker />
        <UIProvider><FeaturesProvider>{children}</FeaturesProvider></UIProvider>
      </body>
    </html>
  );
}
