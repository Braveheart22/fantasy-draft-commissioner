const blockedFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (/^https?:\/\//i.test(url)) throw new Error(`Outbound network access is disabled during the packaged E2E rehearsal: ${url}`);
  return blockedFetch(input, init);
};
