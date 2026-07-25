# `@gate` — marking a test as known-failing, without lying about it

`it.skip` is a dead end. Nothing tells you when the bug it was hiding gets
fixed, so the test stays skipped, then stays skipped after it would have passed,
and eventually rots. `// @gate` replaces it with a tripwire.

```ts
// Blocked on the optimization that marks a route as fully static when no
// dynamic params are referenced in Server Components.
// @gate !cacheComponents
it('navigate to page with a lazily-generated static param', async () => {
  // body unchanged
})
```

The test **still runs**. Because `cacheComponents` is on for this fixture the
condition is false, so the failure is expected: the suite stays green and the run
logs

```
  ⚠ gated test failed as expected (@gate !cacheComponents)
```

The day the underlying bug is fixed and the body starts passing, CI fails with

```
Gated test passed unexpectedly.

This test is marked `// @gate !cacheComponents`, and that condition is currently
false, so the test was expected to fail — but it passed.
The gate is stale: delete the `// @gate !cacheComponents` pragma (and whatever
workaround came with it).
```

That inversion — condition false + test passes ⇒ **failure** — is the whole
feature. It is lifted from React's `@gate`
(`scripts/jest/setupTests.js`, `scripts/babel/transform-test-gate-pragma.js`),
including the expression grammar, so pragmas read the same in both repos.

## `@gate` vs `@force-gate`

| | runs the body | reports staleness | conditions |
| --- | --- | --- | --- |
| `// @gate <cond>` | always | yes | static and lazy |
| `// @force-gate <cond>` | only when true | no | static only |

`@force-gate` is a real Jest skip (`○ skipped`), which Jest can only decide while
tests are being collected — hence static conditions only, and hence no
tripwire.

**Prefer `@gate`.** Reach for `@force-gate` only when running the body is
impossible rather than merely failing: dev mode has no build output, deploy mode
cannot read the filesystem.

Both forms work on `it`, `test`, `fit`, `describe`, and their `.only` variants.
A gate on a `describe` applies to every test inside it. Several pragmas may stack
on one call; every one of them has to hold.

## Conditions

All condition names are declared in [`conditions.ts`](./conditions.ts) — a typo
fails the whole suite at collection time rather than silently disabling the gate.
There are two tiers:

- **static** — the run's own shape (`dev`, `start`, `deploy`, `mode`,
  `turbopack`, `rspack`, `webpack`, `bundler`, `react18`, `wasm`, `ci`), plus
  `FIXME` / `TODO`, which are always false.
- **lazy** — a predicate over the fixture's *resolved* `next.config`
  (`cacheComponents`, `ppr`, `prefetchInlining`, `output`, …), read the first
  time a gate asks for it.

Lazy conditions read the resolved config and never `process.env`, because
`__NEXT_CACHE_COMPONENTS=true` (the `--experimental` shard) is only applied when
the fixture has not set `cacheComponents` itself, and because resolution implies
flags a fixture never mentions — `cacheComponents: true` alone turns on
`experimental.ppr` and `experimental.cachedNavigations`. A gate therefore stays
correct when a fixture's config changes or a CI shard's env var starts or stops
applying.

Add conditions freely; the guidance for doing so is at the top of
`conditions.ts`.

## Expressions

```
// @gate !dev
// @gate mode === 'start' && !cacheComponents
// @gate !(turbopack || rspack)
// @gate output === 'export'
```

`!`, `&&`, `||`, `===`/`!==` (and `==`/`!=`), parentheses, string and boolean
literals. Values are coerced by truthiness in boolean position, so
`@gate prefetchInlining` works even though it resolves to
`false | {maxSize, maxBundleSize}`.

## How it works

1. `pragma-transform.js` rewrites the pragma into
   `_test_gate([{force,source}], 'it')(...)`. It is a line-oriented regex, not an
   AST transform, so **only the `it(` line changes** and every other line keeps
   its byte offsets — `toMatchInlineSnapshot()` is written back by line/column.
2. `jest-transformer.js` chains that rewrite in front of the SWC transformer
   `next/jest` configures. `jest.config.js` wires it up with
   `withGateTransformer()`.
3. `runtime.ts` installs `_test_gate`, evaluates conditions, and inverts the
   expectation. It also wraps `it`/`test` so a gate on a `describe` reaches the
   tests inside.
4. `state.ts` holds the fixture `createNext()` registered;
   `NextInstance.getResolvedConfig()` resolves its config out of process (in
   process, `loadConfig` would mutate the Jest worker's `process.env` from the
   fixture's `.env` files).

A suite with no lazy gate never resolves a config, so the cost is zero.

## Limitations

- A pragma the transform would not pick up is a **hard error**, not a no-op:
  blank line in between, `it.each` / `it.skip` / `it.failing`, a pragma inside a
  JSDoc block. Reword prose comments that start with `@gate`.
- A `describe`-level gate does not reach `it.each` tests (they bypass the
  `it` wrapper).
- Jest-level timeouts are not invertible. A gated-false body that *stalls* rather
  than throwing is stopped by Jest at the framework level and fails anyway. In
  practice `createRouterAct` and Playwright fail fast instead of stalling.
- Only the test body is gated. A failure from an `afterEach` (e.g. the redbox
  matchers) still fails the test.
- `jest.retryTimes(1)` is on for non-dev CI. A stale gate fails deterministically
  on both attempts, but a *flaky* gated-false test now "passes" whenever it
  happens to fail.
- A gated test's title is unchanged (React renames its to
  `[GATED, SHOULD FAIL] …`; we can't, because a lazy gate is not decided when
  titles are fixed). The `⚠ gated test failed as expected` line is the only
  signal in the log today.

## Tests

`test/unit/gate/` covers the transform, the expression language, and the runtime.
The stale-gate *failure* cannot be asserted from inside Jest — a test that must
fail cannot report itself as passing — so it is verified by hand:

```sh
# add `// @gate dev` above a test that passes in start mode, then:
NEXT_SKIP_ISOLATE=1 pnpm test-start test/e2e/app-dir/segment-cache/basic
# => FAIL … Gated test passed unexpectedly … The gate is stale
```

A child-process harness that automates this (the pattern React uses in
`scripts/babel/__tests__/transform-test-gate-pragma-test.js`) is a worthwhile
follow-up.
