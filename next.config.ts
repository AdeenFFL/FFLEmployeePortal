import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // IT ticket attachments: 8 MB total (lib/it/tickets.ts MAX_TOTAL_ATTACHMENT_BYTES) plus
      // the form fields and multipart overhead. Stays under proxy.ts's default 10 MB
      // request-body buffer (proxyClientMaxBodySize).
      bodySizeLimit: "9mb",
    },
  },
};

export default nextConfig;
