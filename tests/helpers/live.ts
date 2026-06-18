/**
 * Gate for tests that make unmocked calls to live third-party endpoints.
 *
 * These are useful as real smoke tests but make CI non-deterministic (a slow
 * or unreachable endpoint fails the build for reasons unrelated to the
 * change under test — e.g. PR #3 flaked twice on niceTa/wiley). They are
 * SKIPPED by default and run only when RUN_LIVE_TESTS=1:
 *
 *   npm test            # deterministic — live tests skipped
 *   npm run test:live   # includes live-endpoint smoke tests
 *
 * Use `liveDescribe` / `liveIt` for blocks that hit the network without a
 * mock. Deterministic tests (mocked fetch, pure logic, key-absent paths)
 * must keep the normal `describe` / `it` so they always run.
 */
export const LIVE_TESTS_ENABLED = process.env.RUN_LIVE_TESTS === "1";

export const liveDescribe = LIVE_TESTS_ENABLED ? describe : describe.skip;
export const liveIt = LIVE_TESTS_ENABLED ? it : it.skip;
