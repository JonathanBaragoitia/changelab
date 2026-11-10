// Only basket lines and the retry identifier are retained; never customer or payment data.
export function readBasket(storage) {
  try {
    storage ??= sessionStorage;
    const value = JSON.parse(storage.getItem('autocare-basket') ?? 'null');
    if (
      !value ||
      !Array.isArray(value.lines) ||
      value.lines.length > 30 ||
      typeof value.requestId !== 'string' ||
      !/^[a-zA-Z0-9-]{16,80}$/.test(value.requestId)
    )
      return null;
    const seen = new Set();
    for (const line of value.lines) {
      if (
        !line ||
        typeof line.productId !== 'string' ||
        line.productId.length > 80 ||
        seen.has(line.productId) ||
        !Number.isInteger(line.quantity) ||
        line.quantity < 1 ||
        line.quantity > 100 ||
        !Number.isSafeInteger(line.expectedPriceCents) ||
        line.expectedPriceCents < 1
      )
        return null;
      seen.add(line.productId);
    }
    return {
      lines: value.lines.map(({ productId, quantity, expectedPriceCents }) => ({
        productId,
        quantity,
        expectedPriceCents,
      })),
      requestId: value.requestId,
    };
  } catch {
    return null;
  }
}
export function saveBasket(lines, requestId, storage) {
  try {
    storage ??= sessionStorage;
    storage.setItem('autocare-basket', JSON.stringify({ lines, requestId }));
    return true;
  } catch {
    return false;
  }
}
