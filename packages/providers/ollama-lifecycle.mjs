import { createServer } from 'node:net';

export function validateOllamaPort(value = 11437) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid host-configured local model port.');
  return port;
}

/** Refuse occupied ports even when the foreign service is not an Ollama API. */
export function requireFreeOllamaPort(port) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(Error('The configured local model port is occupied; Wolf will not reuse another server.')));
    probe.listen({ host: '127.0.0.1', port: validateOllamaPort(port), exclusive: true }, () => probe.close(resolve));
  });
}

/** Release the shared worker slot only after this exact owned process exits. */
export async function stopOwnedOllama(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}
