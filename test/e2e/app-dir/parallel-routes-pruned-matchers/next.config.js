/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  experimental: {
    pruneUnmatchedParallelRoutes: true,
  },
}

module.exports = nextConfig
