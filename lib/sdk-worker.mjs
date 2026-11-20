import { runSdkOperation } from './sdk-operations.mjs';
import { redact } from './toolkit.mjs';

const requests = new Map();
let sequence = 0, started = false;
process.on('message', async message => {
  if (message.kind === 'token-result') {
    const request = requests.get(message.id);
    requests.delete(message.id);
    if (request) message.error ? request.reject(new Error(message.error)) : request.resolve(message.token);
    return;
  }
  if (message.kind !== 'run' || started) return;
  started = true;
  const log = value => process.send?.({ kind: 'log', value: redact(value) });
  try {
    await runSdkOperation({
      ...message,
      log,
      getToken: scopes => new Promise((resolve, reject) => {
        const id = ++sequence;
        requests.set(id, { resolve, reject });
        process.send({ kind: 'token', id, scopes });
      })
    });
    process.send({ kind: 'result', code: 0 }, () => process.exit(0));
  } catch (error) {
    process.send({ kind: 'result', code: 1, error: redact(error.message) }, () => process.exit(1));
  }
});
process.on('disconnect', () => process.exit(1));
