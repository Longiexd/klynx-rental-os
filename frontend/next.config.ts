import type { NextConfig } from "next";

const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();

if (!apiUrl) {
  throw new Error(
    "NEXT_PUBLIC_API_URL is required. Set it explicitly for development, staging, or production.",
  );
}

const nextConfig: NextConfig = {
  output: "standalone",

  allowedDevOrigins: [
    "rental-os.example.invalid",
    "staging.rental-os.example.invalid",
  ],

  images: {
    unoptimized: true,
  },
};

export default nextConfig;
