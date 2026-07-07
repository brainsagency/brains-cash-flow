/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // The engine uses explicit ".js" import specifiers (ESM/NodeNext style)
    // that actually point at ".ts" sources. Teach webpack to resolve them so
    // the same pure engine compiles under both vitest and Next.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
