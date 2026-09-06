const registeredTests = [];

export function test(name, callback) {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new TypeError('Test name must be a nonempty string.');
  }
  if (typeof callback !== 'function') {
    throw new TypeError('Test callback must be a function.');
  }
  registeredTests.push(Object.freeze({ name, callback }));
}

export function assert(condition, message = 'Assertion failed.') {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertEqual(actual, expected, message = 'Values are not equal.') {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message} Expected ${String(expected)}; received ${String(actual)}.`);
  }
}

export function assertApprox(
  actual,
  expected,
  tolerance = 1e-12,
  message = 'Numbers are not approximately equal.',
) {
  if (
    typeof actual !== 'number'
    || typeof expected !== 'number'
    || !Number.isFinite(actual)
    || !Number.isFinite(expected)
    || Math.abs(actual - expected) > tolerance
  ) {
    throw new Error(
      `${message} Expected ${expected} ± ${tolerance}; received ${actual}.`,
    );
  }
}

export function assertDeepEqual(actual, expected, message = 'Values are not deeply equal.') {
  const actualText = JSON.stringify(actual);
  const expectedText = JSON.stringify(expected);
  if (actualText !== expectedText) {
    throw new Error(`${message}\nExpected: ${expectedText}\nReceived: ${actualText}`);
  }
}

export function assertThrows(callback, expectedMessage, message = 'Expected an exception.') {
  let thrown;
  try {
    callback();
  } catch (error) {
    thrown = error;
  }
  if (!thrown) {
    throw new Error(message);
  }
  if (
    expectedMessage
    && !String(thrown.message).includes(expectedMessage)
  ) {
    throw new Error(
      `Exception did not include "${expectedMessage}". Received "${thrown.message}".`,
    );
  }
  return thrown;
}

export function getRegisteredTests() {
  return Object.freeze([...registeredTests]);
}

export async function runRegisteredTests({ reporter = console } = {}) {
  const results = [];
  for (let index = 0; index < registeredTests.length; index += 1) {
    const registered = registeredTests[index];
    try {
      await registered.callback();
      const result = Object.freeze({
        number: index + 1,
        name: registered.name,
        passed: true,
      });
      results.push(result);
      reporter.log(`PASS ${result.number} — ${result.name}`);
    } catch (error) {
      const result = Object.freeze({
        number: index + 1,
        name: registered.name,
        passed: false,
        error,
      });
      results.push(result);
      reporter.error(`FAIL ${result.number} — ${result.name}`, error);
    }
  }
  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;
  return Object.freeze({
    total: results.length,
    passed,
    failed,
    results: Object.freeze(results),
  });
}
