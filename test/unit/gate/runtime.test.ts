import { __testing, _test_gate, expectTestToFail } from '../../lib/gate/runtime'
import {
  clearGateTestContext,
  setGateTestContext,
} from '../../lib/gate/test-context'
import { clearFixture, registerFixture } from '../../lib/gate/state'

const parseGate = (source: string, force = false) =>
  __testing.parseGate({ force, source })

/** Builds the wrapped body the transform would have installed, and runs it. */
const runGated = (sources: string[], body: () => unknown) => {
  const wrapped = __testing.wrapGatedBody(
    sources.map((s) => parseGate(s)),
    body
  )
  return (wrapped as () => Promise<void>)()
}

type FakeTestFn = jest.Mock & { skip: jest.Mock; only: jest.Mock }

const makeFakeTestFn = (): FakeTestFn =>
  Object.assign(jest.fn(), { skip: jest.fn(), only: jest.fn() }) as FakeTestFn

/**
 * Swaps `global.it` / `global.test` / `global.describe` for spies while `fn`
 * runs, so `_test_gate`'s registration decisions can be observed without
 * actually registering tests.
 */
const withFakeTestGlobals = (fn: () => void) => {
  const fakes = {
    it: makeFakeTestFn(),
    test: makeFakeTestFn(),
    describe: makeFakeTestFn(),
  }
  const originals = {
    it: global.it,
    test: global.test,
    describe: global.describe,
  }
  Object.assign(global, fakes)
  try {
    fn()
  } finally {
    Object.assign(global, originals)
  }
  return fakes
}

const fixtureWith = (config: Record<string, unknown>) => {
  const getResolvedConfig = jest.fn(async () => config)
  registerFixture({ getResolvedConfig })
  return getResolvedConfig
}

describe('@gate runtime', () => {
  let warn: jest.SpyInstance

  beforeEach(() => {
    setGateTestContext({
      mode: 'start',
      bundler: 'webpack',
      react18: false,
      wasm: false,
    })
    warn = jest.spyOn(require('console'), 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    clearFixture()
    clearGateTestContext()
  })

  describe('a gate that holds', () => {
    it('runs the body and lets it pass', async () => {
      const body = jest.fn()
      await runGated(['!dev'], body)
      expect(body).toHaveBeenCalled()
      expect(warn).not.toHaveBeenCalled()
    })

    it('lets a failure through', async () => {
      await expect(
        runGated(['!dev'], () => {
          throw new Error('boom')
        })
      ).rejects.toThrow('boom')
    })
  })

  describe('a gate that is false', () => {
    it('absorbs a failing body and reports it', async () => {
      await runGated(['dev'], () => {
        throw new Error('boom')
      })
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('gated test failed as expected (@gate dev)')
      )
    })

    it('absorbs a rejected promise', async () => {
      await runGated(['dev'], async () => {
        throw new Error('boom')
      })
      expect(warn).toHaveBeenCalled()
    })

    it('FAILS when the body passes, naming the stale pragma', async () => {
      await expect(runGated(['dev'], () => {})).rejects.toThrow(
        /Gated test passed unexpectedly[\s\S]*The gate is stale: delete the `\/\/ @gate dev` pragma/
      )
    })

    it('reports the first false gate when several are applied', async () => {
      await expect(runGated(['!start', 'dev'], () => {})).rejects.toThrow(
        '`// @gate !start` pragma'
      )
    })
  })

  describe('lazy conditions', () => {
    it('reads the running fixture’s resolved config', async () => {
      const getResolvedConfig = fixtureWith({ cacheComponents: true })
      // cacheComponents is on, so `!cacheComponents` is false: a passing body
      // is a stale gate.
      await expect(runGated(['!cacheComponents'], () => {})).rejects.toThrow(
        'Gated test passed unexpectedly'
      )
      expect(getResolvedConfig).toHaveBeenCalled()
    })

    it('holds when the config says so', async () => {
      fixtureWith({ cacheComponents: false })
      const body = jest.fn()
      await runGated(['!cacheComponents'], body)
      expect(body).toHaveBeenCalled()
    })

    it('reads keys that stayed under `experimental`', async () => {
      fixtureWith({ cacheComponents: true, experimental: { ppr: true } })
      const body = jest.fn()
      await runGated(['ppr && cacheComponents'], body)
      expect(body).toHaveBeenCalled()
    })

    it('is not resolved at all for a static-only gate', async () => {
      const getResolvedConfig = fixtureWith({ cacheComponents: true })
      await runGated(['!dev'], () => {})
      expect(getResolvedConfig).not.toHaveBeenCalled()
    })

    it('explains itself when no fixture is registered', async () => {
      clearFixture()
      await expect(runGated(['cacheComponents'], () => {})).rejects.toThrow(
        'no fixture is registered'
      )
    })
  })

  describe('collection-time validation', () => {
    it('rejects an undeclared condition and lists the declared ones', () => {
      expect(() => parseGate('cacheComponnents')).toThrow(
        'references an undeclared condition "cacheComponnents"'
      )
      expect(() => parseGate('cacheComponnents')).toThrow(
        /Declared conditions: .*cacheComponents/
      )
    })

    it('rejects an unparsable expression, quoting the pragma', () => {
      expect(() => parseGate('dev &&')).toThrow(
        'Could not parse `// @gate dev &&`'
      )
    })

    it('rejects a `done`-callback test', () => {
      expect(() =>
        __testing.wrapGatedBody([parseGate('dev')], (done: unknown) => done)
      ).toThrow('cannot use the `done` callback')
    })
  })

  describe('@force-gate', () => {
    it('only accepts statically-known conditions', () => {
      expect(() => parseGate('!cacheComponents', true)).toThrow(
        '`@force-gate` produces a real Jest skip'
      )
      expect(() => parseGate('!cacheComponents', true)).toThrow(
        'Use `// @gate !cacheComponents` instead'
      )
    })

    it('accepts a static condition', () => {
      expect(parseGate('!dev', true).force).toBe(true)
    })

    it('skips the test for real when the condition is false', () => {
      const body = () => {}
      const fakes = withFakeTestGlobals(() => {
        _test_gate([{ force: true, source: 'dev' }], 'it')('a test', body)
      })
      expect(fakes.it.skip).toHaveBeenCalledWith('a test', body, undefined)
      expect(fakes.it).not.toHaveBeenCalled()
    })

    it('registers the test normally when the condition holds', () => {
      const fakes = withFakeTestGlobals(() => {
        _test_gate([{ force: true, source: '!dev' }], 'it')('a test', () => {})
      })
      expect(fakes.it).toHaveBeenCalledTimes(1)
      expect(fakes.it.skip).not.toHaveBeenCalled()
    })

    it('skips a whole describe with describe.skip', () => {
      const fakes = withFakeTestGlobals(() => {
        _test_gate([{ force: true, source: 'dev' }], 'describe')(
          'a suite',
          () => {}
        )
      })
      expect(fakes.describe.skip).toHaveBeenCalledWith(
        'a suite',
        expect.any(Function),
        undefined
      )
      expect(fakes.describe).not.toHaveBeenCalled()
    })

    it('leaves a `@gate` on the same test in charge when it holds', async () => {
      const fakes = withFakeTestGlobals(() => {
        _test_gate(
          [
            { force: true, source: '!dev' },
            { force: false, source: 'dev' },
          ],
          'it'
        )('a test', () => {})
      })
      expect(fakes.it.skip).not.toHaveBeenCalled()
      // The non-force gate is false, so the (passing) body is a stale gate.
      const registered = fakes.it.mock.calls[0][1] as () => Promise<void>
      await expect(registered()).rejects.toThrow(
        'Gated test passed unexpectedly'
      )
    })
  })

  describe('a static condition outside the e2e harness', () => {
    it('explains why it is unavailable', async () => {
      clearGateTestContext()
      await expect(runGated(['dev'], () => {})).rejects.toThrow(
        'no run context has been recorded'
      )
    })
  })

  // The tests above drive the runtime's internals directly. These two go
  // through the real pragma path — the transform rewrote them, and the `it` /
  // `describe` globals installed by `installGate()` registered them. This file
  // pretends the run mode is `start`, so `dev` is false and a failing body is
  // absorbed. The stale-gate direction cannot be asserted from inside Jest (the
  // whole point is that it fails the test); see test/lib/gate/README.md.
  // @gate dev
  it('absorbs a failure through the real pragma path', () => {
    expect(1).toBe(2)
  })

  // @gate dev
  describe('a gate on a describe', () => {
    it('is inherited by a test that has no pragma of its own', () => {
      expect(1).toBe(2)
    })
  })

  describe('expectTestToFail', () => {
    it('throws the provided error when the callback succeeds', async () => {
      const error = new Error('should have failed')
      await expect(expectTestToFail(() => {}, error)).rejects.toBe(error)
    })

    it('resolves when the callback throws', async () => {
      await expect(
        expectTestToFail(() => {
          throw new Error('boom')
        }, new Error('unused'))
      ).resolves.toBeUndefined()
    })
  })
})
