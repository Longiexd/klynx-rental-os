// frontend/app/manifest.ts

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Klynx OS",
    short_name: "Klynx OS",
    description: "Klynx Rental Operating System",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#09090B",
    theme_color: "#09090B",
    icons: [
      {
        src: "/icons/icon-192.png?v=20261011",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png?v=20261011",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/icon-maskable-512.png?v=20261011",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}