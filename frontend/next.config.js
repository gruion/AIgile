/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "http", hostname: "localhost" },
      { protocol: "http", hostname: "jira" },
      { protocol: "https", hostname: "**" },
    ],
  },
};

module.exports = nextConfig;
