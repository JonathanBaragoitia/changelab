import type { PartialReturn } from '../application/partial-returns.ts';
import { remainingSale } from '../application/partial-returns.ts';
import type { ReceiptCancellation } from '../application/receipt-cancellation.ts';
import type { Sale, CommerceRepository } from '../application/commerce.ts';
import { fail } from '../domain/catalog.ts';
import type { GoodsReturn, StockAdjustment } from '../application/warehouse.ts';
import type { DemoCorrection } from '../application/rectification.ts';
import type { DemoInvoice } from '../application/issuance.ts';
import type { Draft } from '../application/billing.ts';
import type { Receipt } from '../application/receiving.ts';
import type { Store } from './store.ts';
export class CommerceStore implements CommerceRepository {
  private store: Store;
  private mailQueue:
    ((sale: Sale, event: 'confirmed' | 'shipped' | 'cancelled') => void) | undefined;
  setMailQueue(queue: (sale: Sale, event: 'confirmed' | 'shipped' | 'cancelled') => void) {
    this.mailQueue = queue;
  }
  queueOrderMail(sale: Sale, event: 'confirmed' | 'shipped' | 'cancelled') {
    this.mailQueue?.(sale, event);
  }
  constructor(store: Store) {
    this.store = store;
    store.transaction(() => {
      store.db.exec(`
        CREATE TABLE IF NOT EXISTS suppliers(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,active INTEGER NOT NULL,version INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS product_details(productId TEXT PRIMARY KEY REFERENCES products(id),description TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS inventory(productId TEXT PRIMARY KEY REFERENCES products(id), quantity INTEGER NOT NULL CHECK(quantity>=0));
        CREATE TABLE IF NOT EXISTS sales(id TEXT PRIMARY KEY, actorId TEXT NOT NULL, requestId TEXT NOT NULL, document TEXT NOT NULL, UNIQUE(actorId,requestId));
        CREATE TABLE IF NOT EXISTS inventory_movements(id INTEGER PRIMARY KEY AUTOINCREMENT, orderId TEXT NOT NULL, productId TEXT NOT NULL, quantity INTEGER NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL, UNIQUE(orderId,productId,kind));
        CREATE TABLE IF NOT EXISTS receipt_cancellations(receiptId TEXT PRIMARY KEY,document TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS stock_receipts(id TEXT PRIMARY KEY,requestId TEXT UNIQUE NOT NULL,supplier TEXT NOT NULL,reference TEXT NOT NULL,productId TEXT NOT NULL,document TEXT NOT NULL,UNIQUE(supplier,reference,productId));
        CREATE TABLE IF NOT EXISTS draft_revisions(draftId TEXT NOT NULL,version INTEGER NOT NULL,document TEXT NOT NULL,reason TEXT NOT NULL,actorId TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(draftId,version));
        CREATE TABLE IF NOT EXISTS goods_returns(orderId TEXT PRIMARY KEY,document TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS stock_adjustments(requestId TEXT PRIMARY KEY,document TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS demo_corrections(id TEXT PRIMARY KEY,invoiceId TEXT UNIQUE NOT NULL,number TEXT UNIQUE NOT NULL,document TEXT NOT NULL);
        CREATE TRIGGER IF NOT EXISTS demo_correction_no_update BEFORE UPDATE ON demo_corrections BEGIN SELECT RAISE(ABORT,'correction is fixed'); END;
        CREATE TRIGGER IF NOT EXISTS demo_correction_no_delete BEFORE DELETE ON demo_corrections BEGIN SELECT RAISE(ABORT,'correction is fixed'); END;
        CREATE TABLE IF NOT EXISTS demo_invoice_counters(year TEXT PRIMARY KEY,value INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS demo_invoices(id TEXT PRIMARY KEY,draftId TEXT UNIQUE NOT NULL,orderId TEXT UNIQUE NOT NULL,number TEXT UNIQUE NOT NULL,document TEXT NOT NULL);
        CREATE TRIGGER IF NOT EXISTS demo_invoice_no_update BEFORE UPDATE ON demo_invoices BEGIN SELECT RAISE(ABORT,'issued document is fixed'); END;
        CREATE TRIGGER IF NOT EXISTS demo_invoice_no_delete BEFORE DELETE ON demo_invoices BEGIN SELECT RAISE(ABORT,'issued document is fixed'); END;
        CREATE TABLE IF NOT EXISTS invoice_drafts(id TEXT PRIMARY KEY,orderId TEXT UNIQUE NOT NULL,document TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS commerce_versions(version TEXT PRIMARY KEY);
      `);
      if (
        !store.db
          .prepare("SELECT version FROM commerce_versions WHERE version='stock-demo-v1'")
          .get()
      ) {
        const insert = store.db.prepare(
          'INSERT INTO inventory(productId,quantity) VALUES(?,20) ON CONFLICT(productId) DO NOTHING',
        );
        for (const product of store.products()) insert.run(product.id);
        store.db.prepare('INSERT INTO commerce_versions VALUES(?)').run('stock-demo-v1');
        store.record('system', 'inventory.seeded', {
          quantityPerProduct: 20,
          mode: 'demonstration',
        });
      }
    });
  }
  products() {
    return this.store.products();
  }
  transaction<T>(operation: () => T): T {
    return this.store.transaction(operation);
  }
  record(actor: string, action: string, detail: unknown) {
    this.store.record(actor, action, detail);
  }
  takeStock(productId: string, quantity: number) {
    return (
      this.store.db
        .prepare('UPDATE inventory SET quantity=quantity-? WHERE productId=? AND quantity>=?')
        .run(quantity, productId, quantity).changes === 1
    );
  }
  saveSale(sale: Sale) {
    for (const line of sale.lines) this.movement(sale.id, line.productId, -line.quantity, 'sale');
    this.store.db
      .prepare('INSERT INTO sales(id,actorId,requestId,document) VALUES(?,?,?,?)')
      .run(sale.id, sale.actorId, sale.requestId, JSON.stringify(sale));
  }

  sale(id: string): Sale | undefined {
    const row = this.store.db.prepare('SELECT document FROM sales WHERE id=?').get(id);
    return row ? (JSON.parse(row.document as string) as Sale) : undefined;
  }
  replaceSale(sale: Sale) {
    if (
      this.store.db
        .prepare('UPDATE sales SET document=? WHERE id=?')
        .run(JSON.stringify(sale), sale.id).changes !== 1
    )
      fail(409, 'ORDER_CHANGED', 'No se pudo actualizar el pedido.');
  }
  applyPartialReturn(value: PartialReturn, updated: Sale) {
    if (value.condition !== 'damaged') {
      this.restock(value.productId, value.quantity);
      this.movement(value.id, value.productId, value.quantity, 'partial-return');
    }
    this.replaceSale(updated);
  }
  returnStock(orderId: string, productId: string, quantity: number) {
    this.restock(productId, quantity);
    this.movement(orderId, productId, quantity, 'cancellation');
  }
  private restock(productId: string, quantity: number) {
    const updated = this.store.db
      .prepare('UPDATE inventory SET quantity=quantity+? WHERE productId=? AND quantity+?<=1000000')
      .run(quantity, productId, quantity);
    if (updated.changes === 1) return;
    if (!this.store.db.prepare('SELECT 1 FROM inventory WHERE productId=?').get(productId))
      fail(409, 'INVENTORY_MISSING', 'Artículo sin inventario.');
    fail(409, 'STOCK_LIMIT', 'El stock no puede superar un millón de unidades por producto.');
  }
  private movement(orderId: string, productId: string, quantity: number, kind: string) {
    this.store.db
      .prepare(
        'INSERT INTO inventory_movements(orderId,productId,quantity,kind,at) VALUES(?,?,?,?,?)',
      )
      .run(orderId, productId, quantity, kind, this.store.timestamp());
  }
  saleByRequest(actorId: string, requestId: string): Sale | undefined {
    const row = this.store.db
      .prepare('SELECT document FROM sales WHERE actorId=? AND requestId=?')
      .get(actorId, requestId);
    return row ? (JSON.parse(row.document as string) as Sale) : undefined;
  }

  customerSales(actorId: string): Sale[] {
    return this.store.db
      .prepare('SELECT document FROM sales WHERE actorId=? ORDER BY rowid DESC')
      .all(actorId)
      .map((row) => JSON.parse(row.document as string) as Sale);
  }
  publicCatalog() {
    return this.store.products().map(({ id, sku, name, category, priceCents }) => ({
      id,
      sku,
      name,
      category,
      priceCents,
      description:
        this.store.db.prepare('SELECT description FROM product_details WHERE productId=?').get(id)
          ?.description ?? '',
      quantity:
        this.store.db.prepare('SELECT quantity FROM inventory WHERE productId=?').get(id)
          ?.quantity ?? 0,
    }));
  }

  receipt(id: string): Receipt | undefined {
    const row = this.store.db.prepare('SELECT document FROM stock_receipts WHERE id=?').get(id);
    return row ? (JSON.parse(String(row.document)) as Receipt) : undefined;
  }
  receiptCancellation(id: string): ReceiptCancellation | undefined {
    const row = this.store.db
      .prepare('SELECT document FROM receipt_cancellations WHERE receiptId=?')
      .get(id);
    return row ? (JSON.parse(String(row.document)) as ReceiptCancellation) : undefined;
  }
  cancelReceipt(value: ReceiptCancellation, receipt: Receipt) {
    if (value.expectedQuantity < receipt.quantity)
      fail(
        409,
        'INSUFFICIENT_STOCK',
        'No hay existencias suficientes para retirar toda la recepción. Revisa los movimientos.',
      );
    const changed = this.store.db
      .prepare('UPDATE inventory SET quantity=quantity-? WHERE productId=? AND quantity=?')
      .run(receipt.quantity, receipt.productId, value.expectedQuantity).changes;
    if (changed !== 1)
      fail(409, 'STOCK_CHANGED', 'Las existencias han cambiado. Actualiza y revisa.');
    this.store.db
      .prepare('INSERT INTO receipt_cancellations VALUES(?,?)')
      .run(value.receiptId, JSON.stringify(value));
    this.movement(receipt.id, receipt.productId, -receipt.quantity, 'receipt-cancellation');
  }
  receiptByRequest(id: string): Receipt | undefined {
    const row = this.store.db
      .prepare('SELECT document FROM stock_receipts WHERE requestId=?')
      .get(id);
    return row ? (JSON.parse(row.document as string) as Receipt) : undefined;
  }

  receiptSupplier(id: string) {
    return this.store.db.prepare('SELECT name,active FROM suppliers WHERE id=?').get(id) as
      { name: string; active: number } | undefined;
  }
  hasSupplierReceipt(id: string, reference: string, productId: string) {
    return !!this.store.db
      .prepare(
        "SELECT id FROM stock_receipts WHERE json_extract(document,'$.supplierId')=? AND reference=? AND productId=?",
      )
      .get(id, reference.toLowerCase(), productId);
  }
  hasReceipt(supplier: string, reference: string, productId: string) {
    return !!this.store.db
      .prepare('SELECT id FROM stock_receipts WHERE supplier=? AND reference=? AND productId=?')
      .get(supplier.toLowerCase(), reference.toLowerCase(), productId);
  }
  receive(receipt: Receipt, allowArchivedProduct = false) {
    const product = allowArchivedProduct
      ? this.store.db.prepare('SELECT id FROM products WHERE id=?').get(receipt.productId)
      : this.products().find((product) => product.id === receipt.productId);
    if (!product) fail(409, 'PRODUCT_UNAVAILABLE', 'Selecciona un producto activo.');
    const row = this.store.db
      .prepare('SELECT quantity FROM inventory WHERE productId=?')
      .get(receipt.productId);
    if (
      !row ||
      typeof row.quantity !== 'number' ||
      !Number.isSafeInteger(row.quantity + receipt.quantity) ||
      row.quantity + receipt.quantity > 1000000
    )
      fail(409, 'STOCK_LIMIT', 'No se puede superar un millón de unidades por producto.');
    this.store.db
      .prepare('INSERT INTO stock_receipts VALUES(?,?,?,?,?,?)')
      .run(
        receipt.id,
        receipt.requestId,
        receipt.supplier.toLowerCase(),
        receipt.reference.toLowerCase(),
        receipt.productId,
        JSON.stringify(receipt),
      );
    this.store.db
      .prepare('UPDATE inventory SET quantity=quantity+? WHERE productId=?')
      .run(receipt.quantity, receipt.productId);
    this.movement(receipt.id, receipt.productId, receipt.quantity, 'receipt');
  }

  draftForOrder(id: string): Draft | undefined {
    const row = this.store.db
      .prepare('SELECT document FROM invoice_drafts WHERE orderId=?')
      .get(id);
    return row ? (JSON.parse(row.document as string) as Draft) : undefined;
  }
  draft(id: string): Draft | undefined {
    const row = this.store.db.prepare('SELECT document FROM invoice_drafts WHERE id=?').get(id);
    return row ? (JSON.parse(row.document as string) as Draft) : undefined;
  }
  saveDraft(draft: Draft) {
    this.store.db
      .prepare('INSERT INTO invoice_drafts VALUES(?,?,?)')
      .run(draft.id, draft.orderId, JSON.stringify(draft));
  }

  reviseDraft(draft: Draft, previous: Draft, reason: string, actorId: string) {
    const insert = this.store.db.prepare('INSERT INTO draft_revisions VALUES(?,?,?,?,?,?)');
    if (
      !this.store.db
        .prepare('SELECT version FROM draft_revisions WHERE draftId=? AND version=?')
        .get(previous.id, previous.version ?? 1)
    )
      insert.run(
        previous.id,
        previous.version ?? 1,
        JSON.stringify(previous),
        'Versión previa conservada',
        previous.createdBy,
        previous.updatedAt ?? previous.createdAt,
      );
    insert.run(draft.id, draft.version!, JSON.stringify(draft), reason, actorId, draft.updatedAt!);
    this.store.db
      .prepare('UPDATE invoice_drafts SET document=? WHERE id=?')
      .run(JSON.stringify(draft), draft.id);
  }
  draftHistory(id: string) {
    return this.store.db
      .prepare(
        'SELECT version,document,reason,actorId,at FROM draft_revisions WHERE draftId=? ORDER BY version',
      )
      .all(id)
      .map((row) => ({
        version: Number(row.version),
        reason: String(row.reason),
        actorId: String(row.actorId),
        at: String(row.at),
        document: JSON.parse(row.document as string) as Draft,
      }));
  }

  invoiceForDraft(id: string): DemoInvoice | undefined {
    const row = this.store.db.prepare('SELECT document FROM demo_invoices WHERE draftId=?').get(id);
    return row ? (JSON.parse(row.document as string) as DemoInvoice) : undefined;
  }
  invoiceForOrder(id: string): DemoInvoice | undefined {
    const row = this.store.db.prepare('SELECT document FROM demo_invoices WHERE orderId=?').get(id);
    return row ? (JSON.parse(row.document as string) as DemoInvoice) : undefined;
  }
  nextInvoiceNumber(year: string) {
    this.store.db
      .prepare(
        'INSERT INTO demo_invoice_counters VALUES(?,1) ON CONFLICT(year) DO UPDATE SET value=value+1',
      )
      .run(year);
    const value = this.store.db
      .prepare('SELECT value FROM demo_invoice_counters WHERE year=?')
      .get(year)!.value;
    return 'DEMO-' + year + '-' + String(value).padStart(6, '0');
  }
  saveInvoice(invoice: DemoInvoice) {
    this.store.db
      .prepare('INSERT INTO demo_invoices VALUES(?,?,?,?,?)')
      .run(
        invoice.id,
        invoice.draft.id,
        invoice.draft.orderId,
        invoice.number,
        JSON.stringify(invoice),
      );
  }

  invoice(id: string): DemoInvoice | undefined {
    const row = this.store.db.prepare('SELECT document FROM demo_invoices WHERE id=?').get(id);
    return row ? (JSON.parse(row.document as string) as DemoInvoice) : undefined;
  }
  correctionForInvoice(id: string): DemoCorrection | undefined {
    const row = this.store.db
      .prepare('SELECT document FROM demo_corrections WHERE invoiceId=?')
      .get(id);
    return row ? (JSON.parse(row.document as string) as DemoCorrection) : undefined;
  }
  nextCorrectionNumber(year: string) {
    return this.nextInvoiceNumber('R-' + year);
  }
  saveCorrection(correction: DemoCorrection) {
    this.store.db
      .prepare('INSERT INTO demo_corrections VALUES(?,?,?,?)')
      .run(correction.id, correction.invoiceId, correction.number, JSON.stringify(correction));
  }

  goodsReturn(id: string): GoodsReturn | undefined {
    const row = this.store.db.prepare('SELECT document FROM goods_returns WHERE orderId=?').get(id);
    return row ? (JSON.parse(row.document as string) as GoodsReturn) : undefined;
  }
  adjustment(id: string): StockAdjustment | undefined {
    const row = this.store.db
      .prepare('SELECT document FROM stock_adjustments WHERE requestId=?')
      .get(id);
    return row ? (JSON.parse(row.document as string) as StockAdjustment) : undefined;
  }
  saveReturn(value: GoodsReturn) {
    const sale = this.sale(value.orderId)!;
    for (const line of sale.lines) {
      this.restock(line.productId, line.quantity);
      this.movement(value.orderId, line.productId, line.quantity, 'return');
    }
    this.replaceSale({ ...sale, status: 'returned' });
    this.store.db
      .prepare('INSERT INTO goods_returns VALUES(?,?)')
      .run(value.orderId, JSON.stringify(value));
  }
  applyAdjustment(value: StockAdjustment) {
    if (!this.products().some((p) => p.id === value.productId))
      fail(409, 'PRODUCT_UNAVAILABLE', 'Producto no disponible.');
    const next = value.expectedQuantity + value.delta;
    if (next < 0 || next > 1000000)
      fail(409, 'STOCK_LIMIT', 'El stock debe quedar entre cero y un millón.');
    if (
      this.store.db
        .prepare('UPDATE inventory SET quantity=? WHERE productId=? AND quantity=?')
        .run(next, value.productId, value.expectedQuantity).changes !== 1
    )
      fail(409, 'STOCK_CHANGED', 'Las existencias han cambiado. Actualiza y revisa el stock.');
    this.movement(value.requestId, value.productId, value.delta, 'adjustment');
    this.store.db
      .prepare('INSERT INTO stock_adjustments VALUES(?,?)')
      .run(value.requestId, JSON.stringify(value));
  }
  snapshot() {
    const sales = this.store.db
      .prepare('SELECT document FROM sales ORDER BY rowid DESC')
      .all()
      .map((row) => JSON.parse(row.document as string) as Sale);

    const corrections = this.store.db
      .prepare('SELECT document FROM demo_corrections ORDER BY rowid DESC')
      .all()
      .map((row) => JSON.parse(row.document as string) as DemoCorrection);
    const issued = this.store.db
      .prepare('SELECT document FROM demo_invoices')
      .all()
      .map((row) => JSON.parse(row.document as string) as DemoInvoice);
    const issuedCents = issued.reduce((sum, invoice) => sum + invoice.draft.totalCents, 0),
      correctedCents = corrections.reduce((sum, correction) => sum + correction.totalCents, 0);
    const activeSales = sales
      .filter((sale) => !['cancelled', 'returned'].includes(sale.status ?? ''))
      .map(remainingSale);
    const revenueCents = activeSales.reduce((sum, sale) => sum + sale.totalCents, 0);
    const costCents = activeSales.reduce((sum, sale) => sum + sale.costCents, 0);

    const taxSales = activeSales.filter((sale) => sale.tax);
    const taxBaseCents = taxSales.reduce((sum, sale) => sum + sale.tax!.baseCents, 0);
    const taxCents = taxSales.reduce((sum, sale) => sum + sale.tax!.taxCents, 0);
    return {
      fiscalMetrics: {
        orders: taxSales.length,
        historicalOrders: activeSales.length - taxSales.length,
        baseCents: taxBaseCents,
        taxCents,
        totalCents: taxBaseCents + taxCents,
        grossMarginCents: taxBaseCents - taxSales.reduce((sum, sale) => sum + sale.costCents, 0),
      },
      inventory: this.store.db.prepare('SELECT productId,quantity FROM inventory').all(),
      sales,
      corrections,
      billingMetrics: { issuedCents, correctedCents, balanceCents: issuedCents + correctedCents },
      invoices: this.store.db
        .prepare('SELECT document FROM demo_invoices ORDER BY rowid DESC')
        .all()
        .map((row) => JSON.parse(row.document as string) as DemoInvoice),
      drafts: this.store.db
        .prepare('SELECT document FROM invoice_drafts ORDER BY rowid DESC')
        .all()
        .map((row) => JSON.parse(row.document as string) as Draft),
      receipts: this.store.db
        .prepare('SELECT document FROM stock_receipts ORDER BY rowid DESC LIMIT 50')
        .all()
        .map((row) => {
          const receipt = JSON.parse(row.document as string) as Receipt;
          return { ...receipt, cancellation: this.receiptCancellation(receipt.id) };
        }),
      movements: this.store.db
        .prepare(
          `WITH entries AS (
          SELECT m.*,r.supplier AS receiptSupplier,r.reference AS receiptReference,
            CASE WHEN m.kind='receipt' AND r.id IS NOT NULL
              THEN json_array(m.kind,r.supplier,r.reference)
              ELSE json_array(m.kind,m.orderId) END AS operationKey
          FROM inventory_movements m LEFT JOIN stock_receipts r ON r.id=m.orderId
        ), recent AS (SELECT operationKey FROM entries GROUP BY operationKey ORDER BY MAX(id) DESC LIMIT 50)
        SELECT * FROM entries WHERE operationKey IN (SELECT operationKey FROM recent) ORDER BY at DESC,id DESC`,
        )
        .all(),
      metrics: {
        orders: sales.length,
        cancelledOrders: sales.filter((sale) => sale.status === 'cancelled').length,
        returnedOrders: sales.filter((sale) => sale.status === 'returned').length,
        revenueCents,
        costCents,
        grossCents: revenueCents - costCents,
      },
    };
  }
}
