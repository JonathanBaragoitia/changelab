export function restockCandidates(rows, purchases) {
  return rows
    .map((row) => {
      let pending = 0,
        draft = 0;
      for (const purchase of purchases) {
        const ordered = purchase.lines
          .filter((line) => line.productId === row.productId)
          .reduce((sum, line) => sum + line.quantity, 0);
        const received = (purchase.deliveries ?? [])
          .flatMap((d) => d.lines)
          .filter((line) => line.productId === row.productId && !line.cancelledReceiptId)
          .reduce((sum, line) => sum + line.quantity, 0);
        if (purchase.status === 'draft') draft += ordered;
        if (['approved', 'sent', 'partially_received'].includes(purchase.status))
          pending += Math.max(0, ordered - received);
      }
      const attention = row.signals.some((s) => ['out-of-stock', 'reorder'].includes(s.code));
      return {
        ...row,
        pending,
        draft,
        attention,
        additional:
          row.suggestedOrderUnits === null ? null : Math.max(0, row.suggestedOrderUnits - pending),
      };
    })
    .sort(
      (a, b) =>
        Number(b.attention) - Number(a.attention) ||
        a.stock - b.stock ||
        a.sku.localeCompare(b.sku),
    );
}
