import { nextTestSetup } from 'e2e-utils'

// These routes use `revalidate` / `dynamic` route segment configs, which Cache
// Components rejects at build time — the fixture can't build at all under it,
// so there's nothing to assert. Skip the whole suite when Cache Components is
// on, resolved from the fixture's config rather than an env var. Because this
// is a lazy `@force-gate`, the build is skipped before it's even attempted.
// @force-gate !cacheComponents
describe('custom-cache-control', () => {
  const { next, isNextDev, isNextDeploy } = nextTestSetup({
    files: __dirname,
  })

  if (isNextDeploy) {
    // customizing these headers won't apply on environments
    // where headers are applied outside of the Next.js server
    it('should skip for deploy', () => {})
    return
  }

  it('should have custom cache-control for app-ssg prerendered', async () => {
    const res = await next.fetch('/app-ssg/first')
    expect(res.headers.get('cache-control')).toBe(
      isNextDev ? 'no-cache, must-revalidate' : 's-maxage=30'
    )
  })

  it('should have custom cache-control for app-ssg lazy', async () => {
    const res = await next.fetch('/app-ssg/lazy')
    expect(res.headers.get('cache-control')).toBe(
      isNextDev ? 'no-cache, must-revalidate' : 's-maxage=31'
    )
  })
  it('should have default cache-control for app-ssg another', async () => {
    const res = await next.fetch('/app-ssg/another')
    expect(res.headers.get('cache-control')).toBe(
      isNextDev
        ? 'no-cache, must-revalidate'
        : 's-maxage=120, stale-while-revalidate=31535880'
    )
  })

  it('should have custom cache-control for app-ssr', async () => {
    const res = await next.fetch('/app-ssr')
    expect(res.headers.get('cache-control')).toBe(
      isNextDev ? 'no-cache, must-revalidate' : 's-maxage=32'
    )
  })

  it('should have custom cache-control for auto static page', async () => {
    const res = await next.fetch('/pages-auto-static')
    expect(res.headers.get('cache-control')).toBe(
      isNextDev ? 'no-cache, must-revalidate' : 's-maxage=33'
    )
  })

  it('should have custom cache-control for pages-ssg prerendered', async () => {
    const res = await next.fetch('/pages-ssg/first')
    expect(res.headers.get('cache-control')).toBe(
      isNextDev ? 'no-cache, must-revalidate' : 's-maxage=34'
    )
  })

  it('should have custom cache-control for pages-ssg lazy', async () => {
    const res = await next.fetch('/pages-ssg/lazy')
    expect(res.headers.get('cache-control')).toBe(
      isNextDev ? 'no-cache, must-revalidate' : 's-maxage=35'
    )
  })

  it('should have default cache-control for pages-ssg another', async () => {
    const res = await next.fetch('/pages-ssg/another')
    expect(res.headers.get('cache-control')).toBe(
      isNextDev
        ? 'no-cache, must-revalidate'
        : 's-maxage=120, stale-while-revalidate=31535880'
    )
  })

  it('should have default cache-control for pages-ssr', async () => {
    const res = await next.fetch('/pages-ssr')
    expect(res.headers.get('cache-control')).toBe(
      isNextDev ? 'no-cache, must-revalidate' : 's-maxage=36'
    )
  })
})
