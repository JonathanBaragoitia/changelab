/** Configuration is explicit: containers change the bind address, never the default local install. */
export function serverAddress(env: NodeJS.ProcessEnv = process.env) {
  const host = env.CHANGELAB_HOST ?? '127.0.0.1',
    raw = env.PORT ?? '4317',
    port = Number(raw);
  if (
    !['127.0.0.1', '0.0.0.0'].includes(host) ||
    !/^\d+$/.test(raw) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error('Invalid Norte Gestión host or port');
  return { host, port };
}
export function ollamaBase(value = process.env.CHANGELAB_OLLAMA_URL ?? 'http://127.0.0.1:11434') {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]', 'host.docker.internal', 'ollama'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Configure a local Ollama endpoint');
  return url.origin;
}
export function localModel(model: string) {
  if (!/^[a-zA-Z0-9][\w./:-]{0,119}$/.test(model) || /(?:^|[:/-])cloud(?:$|[:/-])/i.test(model))
    throw new Error('Configure a local Ollama model');
  return model;
}
