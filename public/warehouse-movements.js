export function groupWarehouseMovements(movements, receipts = []) {
  const groups = new Map();
  for (const movement of movements) {
    const receipt = receipts.find((r) => r.id === movement.orderId);
    const reference =
      movement.kind === 'receipt' && receipt
        ? JSON.stringify([
            receipt.supplierId ?? receipt.supplier.toLowerCase(),
            receipt.reference.toLowerCase(),
          ])
        : movement.orderId;
    const key = movement.operationKey ?? JSON.stringify([movement.kind, reference]);
    let group = groups.get(key);
    if (!group) {
      group = {
        kind: movement.kind,
        reference: movement.receiptReference ?? receipt?.reference ?? movement.orderId,
        supplier: movement.receiptSupplier ?? receipt?.supplier,
        at: movement.at,
        rows: [],
        lastId: movement.id,
      };
      groups.set(key, group);
    }
    group.rows.push({ ...movement });
    if (movement.at > group.at) group.at = movement.at;
    group.lastId = Math.max(group.lastId, movement.id);
  }
  return [...groups.values()].sort((a, b) => b.at.localeCompare(a.at) || b.lastId - a.lastId);
}
