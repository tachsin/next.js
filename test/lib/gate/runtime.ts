/**
 * The `@gate` runtime.
 *
 * `test/lib/gate/pragma-transform.js` rewrites
 *
 * ```
 * // @gate !cacheComponents
 * it('name', body)
 * ```
 *
 * into `_test_gate([{force: false, source: '!cacheComponents'}], 'it')('name', body)`,
 * and this module installs that `_test_gate` global.
 *
 * ## What a gate does
 *
 * `// @gate <condition>` **always runs the test**. If the condition is true the
 * test behaves normally. If the condition is false the expectation is inverted:
 * a failing body is reported as a pass, and a *passing* body is reported as a
 * failure — "the gate is stale, delete it". That inversion is the whole point.
 * An `it.skip` is a dead end that nobody revisits; a `@gate` is a tripwire that
 * fires the day the underlying bug is fixed.
 *
 * Conditions are declared in `./conditions.ts`. Static ones (mode, bundler) are
 * known at collection time; lazy ones are read from the booted fixture's
 * resolved config the first time a gate asks, which is why a gate can only be
 * decided inside the test body.
 */

import { evaluate, parse, type ExprNode } from './expr'
import { getCondition } from './conditions'
import { getResolvedConfigForGates } from './state'
import type { ResolvedNextConfig } from './resolved-config'

/** The shape the transform emits. */
export type GatePragma = {
  force: boolean
  source: string
}

type Gate = GatePragma & {
  node: ExprNode
  names: string[]
  /** True when any referenced condition has to be read off the fixture. */
  needsResolvedConfig: boolean
}

type TestFn = (
  name: string,
  fn?: jest.ProvidesCallback,
  timeout?: number
) => void

/**
 * Gates on an enclosing `describe` apply to every test inside it, including
 * tests that carry no pragma of their own. The stack is pushed while the
 * `describe` body is being collected.
 */
const describeGateStack: Gate[] = []

/** Bodies this module already wrapped, so inherited gates are not re-applied. */
const gatedBodies = new WeakSet<Function>()

function staleGateMessage(gate: Gate): string {
  return (
    `Gated test passed unexpectedly.\n\n` +
    `This test is marked \`// @gate ${gate.source}\`, and that condition is ` +
    `currently false, so the test was expected to fail — but it passed.\n` +
    `The gate is stale: delete the \`// @gate ${gate.source}\` pragma (and ` +
    `whatever workaround came with it).`
  )
}

function parseGate(pragma: GatePragma): Gate {
  let parsed
  try {
    parsed = parse(pragma.source)
  } catch (err) {
    throw new Error(
      `Could not parse \`// @${pragma.force ? 'force-gate' : 'gate'} ${
        pragma.source
      }\`: ${(err as Error).message}`
    )
  }

  const needsResolvedConfig = parsed.names.some(
    (name) => getCondition(name).kind === 'lazy'
  )

  if (pragma.force) {
    // Implemented in a follow-up commit: a real Jest skip has to be decided at
    // collection time, which means static conditions only.
    throw new Error(
      `\`// @force-gate ${pragma.source}\` is not supported yet. Use ` +
        `\`// @gate ${pragma.source}\`.`
    )
  }

  return { ...pragma, ...parsed, needsResolvedConfig }
}

function readCondition(name: string, config?: ResolvedNextConfig): unknown {
  const condition = getCondition(name)
  if (condition.kind === 'static') return condition.value()
  if (!config) {
    // Unreachable: `needsResolvedConfig` makes us resolve the config first.
    throw new Error(`\`@gate ${name}\` was evaluated without a config`)
  }
  return condition.value(config)
}

/** The first gate whose condition is false, or `null` if all of them hold. */
async function findFailingGate(gates: Gate[]): Promise<Gate | null> {
  let config: ResolvedNextConfig | undefined
  if (gates.some((gate) => gate.needsResolvedConfig)) {
    config = await getResolvedConfigForGates()
  }
  for (const gate of gates) {
    if (!evaluate(gate.node, (name) => readCondition(name, config))) {
      return gate
    }
  }
  return null
}

/**
 * Runs `callback` and throws `errorIfItPasses` if it *doesn't* fail. Adapted
 * from React's `scripts/jest/setupTests.js`.
 */
export async function expectTestToFail(
  callback: () => unknown,
  errorIfItPasses: Error
): Promise<void> {
  let didError = false
  try {
    await callback()
  } catch {
    didError = true
  }
  if (!didError) throw errorIfItPasses
}

function wrapGatedBody(
  gates: Gate[],
  callback: Function
): jest.ProvidesCallback {
  if (callback.length > 0) {
    throw new Error(
      `A gated test cannot use the \`done\` callback, because the gate has to ` +
        `observe whether the test failed. Return a promise instead.`
    )
  }

  const body = async function gatedBody(this: unknown): Promise<void> {
    const failing = await findFailingGate(gates)
    if (!failing) {
      await callback.call(this)
      return
    }

    const error = new Error(staleGateMessage(failing))
    Error.captureStackTrace(error, body)
    await expectTestToFail(() => callback.call(this), error)
    require('console').warn(
      `  ⚠ gated test failed as expected (@gate ${failing.source})`
    )
  }

  gatedBodies.add(body)
  return body as jest.ProvidesCallback
}

function resolveTestFn(kind: string): TestFn {
  const g = global as any
  switch (kind) {
    case 'it':
      return g.it
    case 'test':
      return g.test
    case 'fit':
      return g.fit ?? g.it.only
    case 'it.only':
      return g.it.only
    case 'test.only':
      return g.test.only
    case 'describe':
      return g.describe
    case 'describe.only':
      return g.describe.only
    default:
      throw new Error(`\`@gate\` does not support \`${kind}(...)\``)
  }
}

export function _test_gate(pragmas: GatePragma[], kind: string) {
  // Parsing and validation happen while the test file is being collected, so a
  // typo'd condition fails the whole suite instead of one test.
  const gates = pragmas.map(parseGate)
  const isDescribe = kind.startsWith('describe')
  const testFn = resolveTestFn(kind)

  return function gated(name: string, callback: Function, timeout?: number) {
    if (isDescribe) {
      // Register the `describe` normally, but make its gates visible while its
      // body is collected so nested tests inherit them.
      return testFn(name, function (this: unknown) {
        describeGateStack.push(...gates)
        try {
          return callback.call(this)
        } finally {
          describeGateStack.length -= gates.length
        }
      } as jest.ProvidesCallback)
    }

    const applicable = [...describeGateStack, ...gates]
    return testFn(name, wrapGatedBody(applicable, callback), timeout)
  }
}

/**
 * Every `it` / `test` — gated or not — has to consult the enclosing
 * `describe`'s gates, so the globals are wrapped once. This is the same
 * technique `test/lib/e2e-utils` uses to inject a per-test timeout, and the two
 * wrappers compose.
 *
 * Known gap: `it.each` and friends bypass the wrapper, so a `describe`-level
 * gate does not reach them. `it.each` cannot carry a pragma of its own either
 * (the transform rejects it).
 */
function wrapTestGlobals(): void {
  for (const key of ['it', 'test'] as const) {
    const original = (global as any)[key]
    if (typeof original !== 'function' || original.__gateWrapped) continue

    const wrapped = new Proxy(original, {
      apply(target, thisArg, args: any[]) {
        const [name, callback, timeout] = args
        if (
          describeGateStack.length === 0 ||
          typeof callback !== 'function' ||
          gatedBodies.has(callback)
        ) {
          return Reflect.apply(target, thisArg, args)
        }
        return Reflect.apply(target, thisArg, [
          name,
          wrapGatedBody([...describeGateStack], callback),
          timeout,
        ])
      },
    })
    Object.defineProperty(wrapped, '__gateWrapped', { value: true })
    ;(global as any)[key] = wrapped
  }
}

/** Called from `test/jest-setup-after-env.ts`. */
export function installGate(): void {
  ;(global as any)._test_gate = _test_gate
  wrapTestGlobals()
}

/** Test-only: the parse/validate half, without registering anything. */
export const __testing = { parseGate, findFailingGate, wrapGatedBody }
