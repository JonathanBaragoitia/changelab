import { MailOutbox, MailPump } from './infrastructure/mail-outbox.ts';
import { mailConfiguration } from './infrastructure/mail-transport.ts';
import { needsOwnerDecision } from './application/company-roles.ts';
import { StaffNotices } from './infrastructure/staff-notices.ts';
import { operationsRoutes } from './http/operations-routes.ts';
import { TransportDamages } from './application/transport-damage.ts';
import { TransportStore } from './infrastructure/transport-store.ts';
import { extractTariffRows } from './application/tariff-extraction.ts';
import { parseTariffCsv } from './domain/tariff-csv.ts';
import { SupplierOfferStore } from './infrastructure/supplier-offer-store.ts';
import { Approvals } from './application/approvals.ts';
import { ApprovalStore } from './infrastructure/approval-store.ts';
import { serverAddress } from './infrastructure/runtime-config.ts';
import { analyzeStock, ConfigureStockPolicy } from './application/stock-analysis.ts';
import { StockPolicyStore } from './infrastructure/stock-policy-store.ts';
import { compareCampaigns } from './application/campaigns.ts';
import { ManageTariffs } from './application/tariffs.ts';
import type { TariffBatch } from './application/tariffs.ts';
import { prepareTariffProposal } from './application/tariff-proposal.ts';
import { TariffStore } from './infrastructure/tariff-store.ts';
import { ReverseRefund } from './application/refund-reversal.ts';
import { RegisterRefund } from './application/refunds.ts';
import { reconcileOrders } from './application/reconciliation.ts';
import { CancelReceipt } from './application/receipt-cancellation.ts';
import { reopenPurchaseReceipt } from './application/reopen-purchase-receipt.ts';
import { CancelExpense } from './application/expense-cancellation.ts';
import { TrackBusinessRanking } from './application/business-runs.ts';
import { BusinessRunStore } from './infrastructure/business-run-store.ts';
import { businessContext, businessProposalInput } from './application/business.ts';
import type { OpportunityRanker } from './application/business.ts';
import { businessDate, validDate } from './application/economics.ts';
import { ManageSuppliers } from './application/suppliers.ts';
import { SupplierStore } from './infrastructure/supplier-store.ts';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { AppError, fail } from './domain/catalog.ts';
import { describeAudit } from './application/audit.ts';
import { ProposalService } from './application/proposals.ts';
import { PreparePlan } from './application/planning.ts';
import type { PlanGenerator } from './application/planning.ts';
import { AuthService } from './application/auth.ts';
import { AuthStore } from './infrastructure/auth-store.ts';
import { credentials } from './infrastructure/auth-crypto.ts';
import { OllamaGenerator } from './infrastructure/ollama.ts';
import { CustomerSessions } from './infrastructure/customer-sessions.ts';
import { RegisterExpense, economicReport, period } from './application/economics.ts';
import {
  ManageCatalog,
  categories as catalogCategories,
} from './application/catalog-management.ts';
import { CatalogStore } from './infrastructure/catalog-store.ts';
import { CustomerAccounts } from './application/customer-accounts.ts';
import { CustomerAccountStore } from './infrastructure/customer-account-store.ts';
import { Warehouse } from './application/warehouse.ts';
import { ReverseCash } from './application/cash-reversal.ts';
import { RegisterCash } from './application/cash.ts';
import { CashStore } from './infrastructure/cash-store.ts';
import { ExpenseStore } from './infrastructure/expense-store.ts';
import { RectifyDemoInvoice } from './application/rectification.ts';
import { IssueDemoInvoice } from './application/issuance.ts';
import { PrepareInvoiceDraft, ReviseDraft } from './application/billing.ts';
import { ReceiveStock } from './application/receiving.ts';
import { ManageOrder } from './application/order-management.ts';
import { Checkout, customerView } from './application/commerce.ts';
import { CommerceStore } from './infrastructure/commerce-store.ts';
import { Store, sha } from './infrastructure/store.ts';
import { Purchases, Incidents, type Purchase, type Incident } from './application/operations.ts';
import { PartialReturns, type PartialReturn } from './application/partial-returns.ts';
import { dailyWork, followUp } from './application/workbench.ts';
import { DocumentImports, type DocumentImport } from './application/document-imports.ts';
import { OperationStore } from './infrastructure/operation-store.ts';
import { LocalCommercialAI } from './infrastructure/commercial-ai.ts';
import { shoppingAdvice, type CommercialAI } from './application/shopping-assistance.ts';
import { documentText } from './infrastructure/document-text.ts';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = new Map<string, readonly [string, string]>([
  ['/supplier-prices.js', ['supplier-prices.js', 'text/javascript']],
  ['/tariff-documents.js', ['tariff-documents.js', 'text/javascript']],
  ['/restock-candidates.js', ['restock-candidates.js', 'text/javascript']],
  ['/replenishment.js', ['replenishment.js', 'text/javascript']],
  ['/warehouse-movements.js', ['warehouse-movements.js', 'text/javascript']],
  ['/gestion', ['index.html', 'text/html']],
  ['/carrito', ['basket.html', 'text/html']],
  ['/basket-storage.js', ['basket-storage.js', 'text/javascript']],
  ['/mis-pedidos', ['customer-orders.html', 'text/html']],
  ['/customer-shipping.js', ['customer-shipping.js', 'text/javascript']],
  ['/customer-orders.js', ['customer-orders.js', 'text/javascript']],
  ['/order-tracking.js', ['order-tracking.js', 'text/javascript']],
  ['/payment-summary.js', ['payment-summary.js', 'text/javascript']],
  ['/approvals.js', ['approvals.js', 'text/javascript']],
  ['/', ['index.html', 'text/html']],
  ['/staff-notices.js', ['staff-notices.js', 'text/javascript']],
  ['/mail.js', ['mail.js', 'text/javascript']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/review.js', ['review.js', 'text/javascript']],
  ['/audit.js', ['audit.js', 'text/javascript']],
  ['/tienda', ['storefront.html', 'text/html']],
  ['/storefront.js', ['storefront.js', 'text/javascript']],
  ['/catalog-search.js', ['catalog-search.js', 'text/javascript']],
  ['/storefront.css', ['storefront.css', 'text/css']],
  ['/borrador', ['draft.html', 'text/html']],
  ['/draft.js', ['draft.js', 'text/javascript']],
  ['/draft.css', ['draft.css', 'text/css']],
  ['/economics.js', ['economics.js', 'text/javascript']],
  ['/refunds.js', ['refunds.js', 'text/javascript']],
  ['/cash.js', ['cash.js', 'text/javascript']],
  ['/catalog-management.js', ['catalog-management.js', 'text/javascript']],
  ['/suppliers.js', ['suppliers.js', 'text/javascript']],
  ['/stock-analysis.js', ['stock-analysis.js', 'text/javascript']],
  ['/business.js', ['business.js', 'text/javascript']],
  ['/reconciliation.js', ['reconciliation.js', 'text/javascript']],
  ['/billing.js', ['billing.js', 'text/javascript']],
  ['/warehouse.js', ['warehouse.js', 'text/javascript']],
  ['/warehouse-preparation.js', ['warehouse-preparation.js', 'text/javascript']],
  ['/transport.js', ['transport.js', 'text/javascript']],
  ['/tariffs.js', ['tariffs.js', 'text/javascript']],
  ['/campaigns.js', ['campaigns.js', 'text/javascript']],
  ['/shop.js', ['shop.js', 'text/javascript']],
  ['/styles.css', ['styles.css', 'text/css']],
  ['/theme.js', ['theme.js', 'text/javascript']],
  ['/theme.css', ['theme.css', 'text/css']],
  ['/disclosures.js', ['disclosures.js', 'text/javascript']],
  ['/operations.js', ['operations.js', 'text/javascript']],
  ['/navigation.js', ['navigation.js', 'text/javascript']],
  ['/shopping-assistant.js', ['shopping-assistant.js', 'text/javascript']],
]);
const cookieName = 'changelab_session';
function cookie(token: string, maxAge = 8 * 60 * 60) {
  // HTTP loopback only. Shared deployment requires HTTPS and a Secure cookie.
  return cookieName + '=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + maxAge;
}
function tokenFor(req: IncomingMessage, name = cookieName) {
  const values = (req.headers.cookie ?? '')
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.startsWith(name + '='));
  return values.length === 1 ? values[0]?.slice(name.length + 1) : undefined;
}
async function readBody(req: IncomingMessage, limit = 16384): Promise<Record<string, unknown>> {
  if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json')
    fail(415, 'JSON_REQUIRED', 'Se requiere JSON.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) fail(413, 'BODY_LIMIT', 'Petición demasiado grande.');
    chunks.push(bytes);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    fail(400, 'INVALID_JSON', 'JSON no válido.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    fail(400, 'INVALID_BODY', 'Se requiere un objeto JSON.');
  return body as Record<string, unknown>;
}
export function makeServer(
  store: Store,
  generator: PlanGenerator & {
    status(): Promise<{ provider: string; model: string; available: boolean; message: string }>;
  } = new OllamaGenerator(process.env.CHANGELAB_MODEL),
  businessRanker: OpportunityRanker = new OllamaGenerator(process.env.CHANGELAB_MODEL),
  commercialAI: CommercialAI = new LocalCommercialAI(),
) {
  const staffNotices = new StaffNotices(store);
  const auth = new AuthService(new AuthStore(store.db), credentials);
  const planner = new PreparePlan(store, generator);
  const service = new ProposalService(
    store,
    { hash: sha },
    { now: () => new Date().toISOString() },
    { next: randomUUID },
  );
  const commerce = new CommerceStore(store);
  const mailConfig = mailConfiguration();
  const mailOutbox = new MailOutbox(store, mailConfig.portal);
  commerce.setMailQueue((sale, event) => {
    // Guardamos el modo al crear el pedido. Un reinicio antes del siguiente ciclo no debe convertir una vista previa en un envío.
    mailOutbox.queue(sale, event, mailConfig.mode === 'preview');
  });
  const mailPump = new MailPump(mailOutbox, mailConfig.transport);
  const checkout = new Checkout(commerce, randomUUID, () => new Date().toISOString());
  const expenses = new ExpenseStore(store),
    registerExpense = new RegisterExpense(expenses);
  const cash = new CashStore(store, commerce, expenses),
    registerCash = new RegisterCash(cash);
  const cancelExpense = new CancelExpense(expenses, (id) => cash.settled('payment', id));
  const reverseRefund = new ReverseRefund(cash);
  const registerRefund = new RegisterRefund(cash);
  const warehouse = new Warehouse(commerce, () => new Date().toISOString());
  const reverseCash = new ReverseCash(cash, () => new Date().toISOString());
  const rectification = new RectifyDemoInvoice(commerce, randomUUID, () =>
    new Date().toISOString(),
  );
  const issuance = new IssueDemoInvoice(commerce, randomUUID, () => new Date().toISOString());
  const revisions = new ReviseDraft(commerce, () => new Date().toISOString());
  const billing = new PrepareInvoiceDraft(commerce, randomUUID, () => new Date().toISOString());
  const receiving = new ReceiveStock(commerce, randomUUID, () => new Date().toISOString());
  const purchaseStore = new OperationStore<Purchase>(store, 'purchase');
  const transportStore = new TransportStore(store, (id) => purchaseStore.get(id));
  const transport = new TransportDamages(transportStore, warehouse, () => new Date().toISOString());
  const purchaseReceipt = (purchaseId: string, productId: string, deliveryId?: string) =>
    commerce.receiptByRequest(
      sha({ purchaseId, productId, ...(deliveryId ? { deliveryId } : {}) }),
    );
  const cancelReceipt = new CancelReceipt(
    commerce,
    (receipt) => transport.guardReceiptCancellation(receipt),
    (receipt, actorId) => {
      const purchaseId = transportStore.purchaseForReceipt(receipt);
      if (!purchaseId) return;
      const purchase = purchaseStore.get(purchaseId);
      if (!purchase) fail(409, 'PURCHASE_MISSING', 'No se encuentra la compra de la recepción.');
      const updated = reopenPurchaseReceipt(purchase, receipt, (productId, deliveryId) =>
        purchaseReceipt(purchaseId, productId, deliveryId),
      );
      purchaseStore.save(updated, purchase.version);
      purchaseStore.record(actorId, 'purchase.receipt-reopened', {
        id: purchaseId,
        receiptId: receipt.id,
        productId: receipt.productId,
        quantity: receipt.quantity,
        status: updated.status,
      });
      return purchaseId;
    },
  );
  const supplierOffers = new SupplierOfferStore(store);
  const incidentStore = new OperationStore<Incident>(store, 'incident');
  const returnStore = new OperationStore<PartialReturn>(store, 'partial-return');
  const importStore = new OperationStore<DocumentImport>(store, 'document-import');
  const purchases = new Purchases(
    purchaseStore,
    () => store.products(),
    (id) => commerce.receiptSupplier(id),
    (actor, purchase, reference, deliveryId) => {
      for (const line of purchase.lines)
        receiving.receivePurchase(actor, purchase, {
          requestId: sha({
            purchaseId: purchase.id,
            productId: line.productId,
            ...(deliveryId ? { deliveryId } : {}),
          }),
          productId: line.productId,
          quantity: line.quantity,
          supplierId: purchase.supplierId,
          supplier: purchase.supplierName,
          reference,
        });
    },
    randomUUID,
    () => new Date().toISOString(),
    (supplierId, productId) => supplierOffers.get(supplierId, productId),
  );
  const incidents = new Incidents(
    incidentStore,
    (id) => !!commerce.sale(id),
    randomUUID,
    () => new Date().toISOString(),
  );
  const partialReturns = new PartialReturns(
    returnStore,
    (id) => commerce.sale(id),
    (value, sale) => commerce.applyPartialReturn(value, sale),
    () => new Date().toISOString(),
  );
  const imports = new DocumentImports(
    importStore,
    () => store.products(),
    sha,
    randomUUID,
    () => new Date().toISOString(),
  );
  const orderManagement = new ManageOrder(commerce, () => store.timestamp());
  const supplierStore = new SupplierStore(store),
    manageSuppliers = new ManageSuppliers(supplierStore, randomUUID);
  const catalogStore = new CatalogStore(store),
    catalogManagement = new ManageCatalog(catalogStore, randomUUID);
  const customerAccounts = new CustomerAccounts(new CustomerAccountStore(store.db), credentials);
  const customers = new CustomerSessions(store.db);
  const approvalStore = new ApprovalStore(store);
  const approvals = new Approvals(approvalStore, () => new Date().toISOString());

  const stockPolicies = new StockPolicyStore(store);
  const configureStockPolicy = new ConfigureStockPolicy(stockPolicies);
  const stockSnapshot = () => {
    const now = new Date(),
      from = new Date(now.getTime() - 29 * 86400000),
      snapshot = commerce.snapshot();
    return analyzeStock(
      store.products(),
      snapshot.inventory.map((r) => ({
        productId: String(r.productId),
        quantity: Number(r.quantity),
      })),
      snapshot.sales,
      businessDate(from.toISOString()),
      businessDate(now.toISOString()),
      stockPolicies.all(),
    );
  };
  const contextSnapshot = () => {
    const now = new Date(),
      from = new Date(now.getTime() - 29 * 86400000);
    const snapshot = commerce.snapshot();
    const context = businessContext(
      store.products(),
      snapshot.inventory.map((row) => ({
        productId: String(row.productId),
        quantity: Number(row.quantity),
      })),
      snapshot.sales,
      businessDate(from.toISOString()),
      businessDate(now.toISOString()),
    );
    const stock = stockSnapshot();
    const extra = stock.rows
      .flatMap((row) =>
        row.signals
          .filter((signal) =>
            ['reorder', 'no-recorded-sales', 'high-coverage'].includes(signal.code),
          )
          .map((signal) => ({
            id: 'stock-' + row.productId + '-' + signal.code,
            category: row.category,
            code: 'stock-' + signal.code,
            message: row.sku + ' · ' + row.name + ': ' + signal.message,
          })),
      )
      .sort((a, b) => Number(b.code === 'stock-reorder') - Number(a.code === 'stock-reorder'))
      .slice(0, 20);
    context.opportunities.push(...extra);
    return {
      context,
      contextHash: sha({ context, products: store.products(), policies: stockPolicies.all() }),
    };
  };
  const businessRuns = new BusinessRunStore(store);
  const trackedRanking = new TrackBusinessRanking(businessRuns);
  const tariffStore = new TariffStore(store),
    tariffs = new ManageTariffs(tariffStore, sha, randomUUID);
  const tariffDecisionPending = new Set<string>();
  function assertTariffDecisionSource(batch: TariffBatch) {
    if (!batch.source) return;
    const source = tariffStore.source(batch.source.id);
    if (!source || sha(source) !== sha(batch.source))
      fail(409, 'TARIFF_SOURCE', 'El documento de origen ya no coincide con la tarifa.');
  }
  function tariffDecisionInput(batch: TariffBatch, products = store.products()) {
    const ids = new Set(batch.changes.map((change) => change.productId));
    const selected = products.filter((product) => ids.has(product.id));
    const offers = batch.target
      ? batch.changes.map((change) => tariffStore.offer(batch.supplierId, change.productId))
      : [];
    const supplier = tariffStore.supplier(batch.supplierId);
    const current =
      Boolean(supplier?.active) &&
      batch.changes.every((change, index) => {
        const product = selected.find((candidate) => candidate.id === change.productId);
        if (!product) return false;
        const applied = batch.status === 'applied';
        const expectedCost = applied ? change.afterCostCents : change.beforeCostCents;
        if (!batch.target) return product.costCents === expectedCost;
        const offer = offers[index];
        return (
          offer?.costCents === expectedCost &&
          offer.version === change.baseVersion + Number(applied)
        );
      });
    return {
      products: selected,
      current,
      fingerprint: sha({ digest: batch.digest, status: batch.status, selected, offers, supplier }),
    };
  }
  const purchaseReport = () =>
    purchaseStore.all().map((p) => ({
      ...p,
      receiptWarnings: p.deliveries
        ? p.deliveries
            .flatMap((d) =>
              d.lines
                .filter((line) => !line.cancelledReceiptId)
                .map((line) => ({
                  deliveryId: d.legacy ? undefined : d.id,
                  productId: line.productId,
                })),
            )
            .filter((l) => {
              const receipt = purchaseReceipt(p.id, l.productId, l.deliveryId);
              return receipt && commerce.receiptCancellation(receipt.id);
            }).length
        : p.lines.filter((l) => {
            const receipt = commerce.receiptByRequest(
              sha({ purchaseId: p.id, productId: l.productId }),
            );
            return receipt && commerce.receiptCancellation(receipt.id);
          }).length,
    }));
  const workSnapshot = () => {
    const snapshot = commerce.snapshot();
    return dailyWork({
      products: store.products(),
      sales: snapshot.sales,
      purchases: purchaseReport(),
      incidents: incidentStore.all(),
      transportDamages: transportStore.all(),
      proposals: store.proposals(),
      stock: stockSnapshot().rows,
      reconciliation: reconcileOrders(
        snapshot.sales,
        snapshot.invoices,
        snapshot.corrections,
        cash.active(),
        cash.activeRefunds(),
      ),
    });
  };
  const getFollowUp = () =>
    followUp(
      store.proposals(),
      commerce.snapshot().sales,
      store.products(),
      new Date().toISOString(),
    );
  const operationRoutes = operationsRoutes({
    purchases,
    incidents,
    partialReturns,
    imports,
    incidentStore,
    importStore,
    tasks: workSnapshot,
    followUp: getFollowUp,
    ai: commercialAI,
    extractText: documentText,
    report: () => ({
      purchases: purchaseReport(),
      incidents: incidentStore.all(),
      returns: returnStore.all(),
      imports: importStore.all().map(({ source, ...rest }) => rest),
      tasks: workSnapshot(),
      followUp: getFollowUp(),
    }),
    process: (actor, id, body) =>
      imports.process(actor, id, body, (kind, supplierId, reference, rows) => {
        if (kind === 'tariff')
          return tariffs.preview(actor, {
            supplierId,
            reference,
            csv:
              'sku;coste\n' +
              rows.map((r) => r.sku + ';' + (r.costCents! / 100).toFixed(2)).join('\n'),
          });
        return rows.map((r) =>
          receiving.execute(actor, {
            supplierId,
            supplier: 'Proveedor seleccionado',
            reference,
            requestId: sha({ importId: id, sku: r.sku }),
            productId: store.products().find((p) => p.sku.toUpperCase() === r.sku)!.id,
            quantity: r.quantity,
          }),
        );
      }),
  });

  let ranking = false;
  let tariffExtracting = false;
  let planning = false;
  const server = createServer(async (req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };
    try {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? ''))
        fail(403, 'HOST_DENIED', 'Host no permitido.');
      const url = new URL(req.url ?? '/', 'http://localhost');
      const asset = assets.get(url.pathname);
      if (req.method === 'GET' && asset) {
        const [file, type] = asset;
        const bytes = await readFile(resolve(root, 'public', file));
        res.writeHead(200, {
          'Content-Type': type + '; charset=utf-8',
          'Cache-Control': 'no-cache',
        });
        res.end(bytes);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/health') {
        json(200, { status: 'ok', mode: 'local-auth', planner: 'ollama' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/shop') {
        let customer = customers.current(tokenFor(req, 'autocare_guest'));
        if (!customer) {
          const created = customers.create();
          res.setHeader(
            'Set-Cookie',
            'autocare_guest=' +
              created.token +
              '; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800',
          );
          customer = created;
        }
        json(200, {
          csrf: customer.csrf,
          account: customerAccounts.profile(customer.id),
          products: commerce.publicCatalog(),
          orders: commerce.customerSales(customer.id).map(customerView),
        });
        return;
      }
      const token = tokenFor(req);
      if (req.method === 'GET' && url.pathname === '/api/session') {
        try {
          const session = auth.current(token);
          json(200, { actor: session.actor, csrf: session.csrf, setupRequired: false });
        } catch (error) {
          if (!(error instanceof AppError) || error.status !== 401) throw error;
          json(200, { actor: null, csrf: null, setupRequired: !auth.hasAccounts() });
        }
        return;
      }
      let body: Record<string, unknown> = {};
      if (req.method === 'POST') {
        if (req.headers.origin !== 'http://' + req.headers.host)
          fail(403, 'ORIGIN_DENIED', 'Origen no permitido.');
        body = await readBody(
          req,
          ['/api/document-imports/extract', '/api/tariff-documents'].includes(url.pathname)
            ? 2900000
            : 16384,
        );
        if (url.pathname === '/api/login') {
          if (Object.keys(body).some((key) => !['username', 'password'].includes(key)))
            fail(400, 'INVALID_LOGIN', 'Campos de acceso no permitidos.');
          const session = await auth.login(
            body.username,
            body.password,
            req.socket.remoteAddress ?? 'local',
          );
          if (token) auth.logout(token);
          res.setHeader('Set-Cookie', cookie(session.token));
          json(200, { actor: session.actor, csrf: session.csrf });
          return;
        }
      }

      if (
        req.method === 'POST' &&
        [
          '/api/shop/register',
          '/api/shop/login',
          '/api/shop/logout',
          '/api/shop/address',
          '/api/shop/profile',
        ].includes(url.pathname)
      ) {
        const oldToken = tokenFor(req, 'autocare_guest'),
          customer = customers.require(oldToken);
        const csrf = req.headers['x-csrf-token'];
        if (
          typeof csrf !== 'string' ||
          !/^[a-f0-9]{64}$/.test(csrf) ||
          !timingSafeEqual(Buffer.from(csrf, 'hex'), Buffer.from(customer.csrf, 'hex'))
        )
          fail(403, 'CSRF_DENIED', 'Sesión de compra no válida.');
        if (url.pathname === '/api/shop/profile') {
          const account = await customerAccounts.updateProfile(customer.id, body);
          const next = customers.create(customer.id);
          res.setHeader(
            'Set-Cookie',
            'autocare_guest=' + next.token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800',
          );
          json(200, { account, csrf: next.csrf });
          return;
        }
        if (url.pathname === '/api/shop/address') {
          json(200, { account: customerAccounts.updateAddress(customer.id, body) });
          return;
        }
        let id: string | undefined;
        if (url.pathname !== '/api/shop/logout')
          id = await customerAccounts.execute(
            url.pathname.endsWith('register') ? 'register' : 'login',
            customer.id,
            body,
            req.socket.remoteAddress ?? 'local',
          );
        customers.revoke(oldToken);
        const next = customers.create(id);
        res.setHeader(
          'Set-Cookie',
          'autocare_guest=' + next.token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800',
        );
        json(200, { account: customerAccounts.profile(next.id), csrf: next.csrf });
        return;
      }
      const customerCancellation = /^\/api\/shop\/orders\/([\w-]+)\/cancel$/.exec(url.pathname);
      if (
        req.method === 'POST' &&
        (['/api/shop/orders', '/api/shop/advice'].includes(url.pathname) || customerCancellation)
      ) {
        const customer = customers.require(tokenFor(req, 'autocare_guest'));
        const csrf = req.headers['x-csrf-token'];
        if (
          typeof csrf !== 'string' ||
          !/^[a-f0-9]{64}$/.test(csrf) ||
          !timingSafeEqual(Buffer.from(csrf, 'hex'), Buffer.from(customer.csrf, 'hex'))
        )
          fail(403, 'CSRF_DENIED', 'La petición no corresponde a esta sesión de compra.');
        if (customerCancellation?.[1])
          json(
            200,
            customerView(
              orderManagement.cancelByCustomer(customer.id, customerCancellation[1], body),
            ),
          );
        else if (url.pathname === '/api/shop/advice')
          json(200, await shoppingAdvice(commercialAI, body, commerce.publicCatalog()));
        else json(201, customerView(checkout.customerCheckout(customer.id, body)));
        return;
      }
      const session = auth.current(token),
        actor = session.actor;
      if (req.method === 'POST') {
        const csrf = req.headers['x-csrf-token'];
        if (
          typeof csrf !== 'string' ||
          !/^[a-f0-9]{64}$/.test(csrf) ||
          !timingSafeEqual(Buffer.from(csrf, 'hex'), Buffer.from(session.csrf, 'hex'))
        ) {
          fail(403, 'CSRF_DENIED', 'La petición no corresponde a esta sesión.');
        }
        if (url.pathname === '/api/logout') {
          auth.logout(token!);
          res.setHeader('Set-Cookie', cookie('', 0));
          json(200, { status: 'signed-out' });
          return;
        }
      }

      const disposal = /^\/api\/partial-returns\/([\w-]+)\/disposal$/.exec(url.pathname);
      if (req.method === 'POST' && disposal?.[1]) {
        const value = partialReturns.dispose(actor, disposal[1], body);
        json(200, { id: value.id, version: value.version });
        return;
      }

      if (url.pathname === '/api/mail' || url.pathname.startsWith('/api/mail/')) {
        const allowed =
          actor.businessRole === 'owner' ||
          actor.businessRole === 'office' ||
          (!actor.ownerApprovalRequired && actor.role === 'editor');
        if (!allowed || actor.profile === 'warehouse')
          fail(
            403,
            'FORBIDDEN',
            'Solo oficina y dirección pueden consultar los correos a clientes.',
          );
        if (req.method === 'GET' && url.pathname === '/api/mail') {
          json(200, {
            mode: mailConfig.mode,
            message: mailConfig.message,
            jobs: mailOutbox.list(),
          });
          return;
        }
        const preview = /^\/api\/mail\/([a-f0-9]{64})\/preview$/.exec(url.pathname);
        if (req.method === 'GET' && preview?.[1]) {
          const eml = mailOutbox.eml(preview[1], mailConfig.from);
          res.writeHead(200, {
            'Content-Type': 'message/rfc822',
            'Content-Disposition': 'attachment; filename="correo-pedido.eml"',
            'Cache-Control': 'no-store',
          });
          res.end(eml);
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/mail/capture') {
          if (Object.keys(body).some((k) => k !== 'orderId') || typeof body.orderId !== 'string')
            fail(400, 'INVALID_ORDER', 'Selecciona un pedido.');
          const sale = commerce.sale(body.orderId);
          if (!sale) fail(404, 'ORDER_NOT_FOUND', 'Pedido no encontrado.');
          const event =
            sale.status === 'shipped'
              ? 'shipped'
              : sale.status === 'cancelled'
                ? 'cancelled'
                : 'confirmed';
          json(201, { id: store.transaction(() => mailOutbox.queue(sale, event, true)) });
          return;
        }
        const retry = /^\/api\/mail\/([a-f0-9]{64})\/retry$/.exec(url.pathname);
        if (req.method === 'POST' && retry?.[1]) {
          mailOutbox.retry(retry[1], Date.now(), actor.id);
          json(200, { ok: true });
          return;
        }
        fail(404, 'NOT_FOUND', 'Ruta de correo no disponible.');
      }

      if (req.method === 'GET' && url.pathname === '/api/staff-notices') {
        json(200, { recipient: actor.id, notices: staffNotices.list(actor) });
        return;
      }
      const noticeRead = /^\/api\/staff-notices\/([\w-]+)\/read$/.exec(url.pathname);
      if (req.method === 'POST' && noticeRead?.[1]) {
        staffNotices.read(actor, noticeRead[1]);
        json(200, { ok: true });
        return;
      }

      if (
        needsOwnerDecision(actor) &&
        actor.profile !== 'warehouse' &&
        req.method === 'POST' &&
        (url.pathname === '/api/transport-damages' ||
          url.pathname === '/api/partial-returns' ||
          /^\/api\/orders\/[\w-]+\/return$/.test(url.pathname) ||
          /^\/api\/inventory\//.test(url.pathname) ||
          (/^\/api\/orders\/[\w-]+\/status$/.test(url.pathname) &&
            ['prepared', 'shipped'].includes(String(body.status))))
      )
        fail(
          403,
          'WAREHOUSE_REQUIRED',
          'Esta operación física corresponde a Mario en Almacén. Oficina tramita los documentos, envíos y reclamaciones.',
        );

      if (
        needsOwnerDecision(actor) &&
        actor.profile !== 'warehouse' &&
        req.method === 'POST' &&
        (url.pathname === '/api/supplier-offers' ||
          url.pathname === '/api/expenses' ||
          /^\/api\/expenses\/[\w-]+\/cancel$/.test(url.pathname) ||
          url.pathname === '/api/refunds' ||
          /^\/api\/cash\/[\w-]+\/reverse$/.test(url.pathname) ||
          /^\/api\/billing\/invoices\/[\w-]+\/rectify$/.test(url.pathname) ||
          /\/refunds\//.test(url.pathname))
      )
        fail(
          403,
          'OWNER_APPROVAL_REQUIRED',
          'Esta decisión requiere autorización de Antonio. Prepara la solicitud para su revisión.',
        );

      if (actor.profile === 'warehouse') {
        // Almacén solo puede usar las rutas autorizadas aquí, también si llama a la API directamente.
        const warehousePurchase = (p: Purchase) => ({
          id: p.id,
          version: p.version,
          status: p.status,
          supplierId: p.supplierId,
          supplierName: p.supplierName,
          reference: p.reference,
          sentAt: p.sentAt,
          expectedDate: p.expectedDate,
          deliveries: p.deliveries,
          lines: p.lines.map(({ productId, sku, name, quantity }) => ({
            productId,
            sku,
            name,
            quantity,
          })),
        });
        if (req.method === 'GET' && url.pathname === '/api/workspace') {
          const snapshot = commerce.snapshot();
          json(200, {
            actor,
            scenario: process.env.CHANGELAB_SCENARIO ?? null,
            inventory: snapshot.inventory,
            receipts: snapshot.receipts,
            movements: snapshot.movements,
            sales: snapshot.sales.map(
              ({
                id,
                status,
                createdAt,
                preparedBy,
                shippedBy,
                dispatch,
                customer,
                lines,
                returnedQuantities,
              }) => ({
                id,
                status,
                createdAt,
                preparedBy,
                shippedBy,
                dispatch,
                returnedQuantities,
                ...(customer ? { customer: { name: customer.name } } : {}),
                lines: lines.map(({ productId, name, quantity }) => ({
                  productId,
                  name,
                  quantity,
                })),
              }),
            ),
            suppliers: supplierStore
              .suppliers()
              .map(({ id, name, active }) => ({ id, name, active })),
            products: store
              .products()
              .map(({ id, sku, name, category }) => ({ id, sku, name, category })),
            goodsReturns: returnStore
              .all()
              .map(
                ({
                  id,
                  orderId,
                  productId,
                  quantity,
                  condition,
                  reason,
                  createdBy,
                  createdAt,
                  version,
                  disposal,
                }) => ({
                  id,
                  orderId,
                  productId,
                  quantity,
                  condition: condition ?? 'sellable',
                  reason,
                  createdBy,
                  createdAt,
                  version,
                  ...(disposal ? { disposal } : {}),
                }),
              ),
            proposals: [],
            stockReviewCount: 0,
            identityNames: store.identityNames(),
            planner: { message: 'Espacio operativo de almacén.' },
          });
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/warehouse/purchases') {
          json(200, {
            purchases: purchaseStore
              .all()
              .filter((p) =>
                ['approved', 'sent', 'partially_received', 'received'].includes(p.status),
              )
              .map(warehousePurchase),
          });
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/transport-damages') {
          json(200, {
            damages: transportStore.all().map(({ outcome, resolution, ...damage }) => ({
              ...damage,
              ...(outcome?.kind === 'credit'
                ? { outcome: { kind: 'credit' }, resolution: 'Abono registrado por Dirección.' }
                : { outcome, resolution }),
            })),
            purchases: purchaseStore
              .all()
              .filter((p) => ['sent', 'partially_received', 'received'].includes(p.status))
              .map(warehousePurchase),
          });
          return;
        }
        const allowedWrite =
          req.method === 'POST' &&
          (url.pathname === '/api/inventory/receipts' ||
            url.pathname === '/api/partial-returns' ||
            url.pathname === '/api/transport-damages' ||
            (/^\/api\/purchases\/[\w-]+$/.test(url.pathname) &&
              ['receive', 'receive-partial'].includes(String(body.action))) ||
            (/^\/api\/orders\/[\w-]+\/status$/.test(url.pathname) &&
              ['prepared', 'shipped'].includes(String(body.status))));
        if (!allowedWrite)
          fail(403, 'WAREHOUSE_ONLY', 'Tu cuenta solo tiene acceso a las operaciones de almacén.');
        // Return only operational acknowledgements, never the commercial aggregate.
        if (url.pathname === '/api/partial-returns') {
          const value = partialReturns.execute(actor, body);
          json(201, { id: value.id });
          return;
        }
        if (url.pathname === '/api/inventory/receipts') {
          const value = receiving.execute(actor, body);
          json(201, { id: value.id });
          return;
        }
        if (url.pathname === '/api/transport-damages') {
          const value = transport.create(actor, body);
          json(201, { id: value.id });
          return;
        }
        const warehouseOrder = /^\/api\/orders\/([\w-]+)\/status$/.exec(url.pathname);
        if (warehouseOrder?.[1]) {
          const value = orderManagement.execute(actor, warehouseOrder[1], body);
          json(200, { id: value.id, status: value.status });
          return;
        }
        const warehouseDelivery = /^\/api\/purchases\/([\w-]+)$/.exec(url.pathname);
        if (warehouseDelivery?.[1]) {
          const value = purchases.transition(actor, warehouseDelivery[1], body);
          json(200, { id: value.id, status: value.status, version: value.version });
          return;
        }
      }

      if (url.pathname === '/api/approvals' && req.method === 'GET') {
        let deliveryPending = false;
        try {
          approvalStore.deliver();
        } catch {
          deliveryPending = true;
        }
        json(200, {
          requests: approvalStore.all(),
          notifications: approvalStore.inbox(actor.id),
          deliveryPending,
        });
        return;
      }
      if (url.pathname === '/api/approvals' && req.method === 'POST') {
        json(201, approvals.create(actor, body));
        return;
      }
      const approvalPath = /^\/api\/approvals\/([\w-]+)$/.exec(url.pathname);
      const executeApproval = /^\/api\/approvals\/([\w-]+)\/expense$/.exec(url.pathname);
      if (executeApproval?.[1] && req.method === 'POST') {
        json(
          201,
          store.transaction(() => {
            const request = approvalStore.get(executeApproval[1]!);
            if (!request || request.status !== 'approved' || request.kind !== 'expense')
              fail(409, 'APPROVAL_REQUIRED', 'Se requiere un gasto aprobado.');
            if (
              needsOwnerDecision(actor) &&
              !store.db
                .prepare(
                  "SELECT 1 FROM user_business_roles WHERE userId=? AND businessRole='owner'",
                )
                .get(request.decision?.actor ?? '')
            )
              fail(403, 'OWNER_APPROVAL_REQUIRED', 'El gasto necesita una aprobación de Antonio.');
            if (Object.keys(body).some((k) => !['date', 'reference', 'vatRate'].includes(k)))
              fail(400, 'INVALID_FIELDS', 'Campos no permitidos.');
            const expense = registerExpense.execute(
              actor,
              {
                ...body,
                requestId: request.id,
                category: request.category,
                description: request.description,
                baseCents: request.cents,
              },
              { approvalId: request.id, approvedBy: request.decision?.actor ?? '' },
            );
            approvalStore.save({ ...request, expenseId: expense.requestId });
            return expense;
          }),
        );
        return;
      }
      if (approvalPath?.[1] && req.method === 'POST') {
        json(200, approvals.resolve(actor, approvalPath[1], body));
        return;
      }
      const operationResult = await operationRoutes(req.method ?? '', url.pathname, body, actor);
      if (operationResult) {
        json(operationResult.status, operationResult.value);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/business-runs') {
        json(200, { runs: businessRuns.latest() });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/stock-analysis') {
        json(200, stockSnapshot());
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/business-context') {
        json(200, contextSnapshot());
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/suppliers') {
        json(200, { suppliers: supplierStore.suppliers(), offers: supplierOffers.all() });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/supplier-offers') {
        json(200, supplierOffers.save(body, actor));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/catalog-management') {
        json(200, { products: catalogStore.records(), categories: catalogCategories });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/reconciliation') {
        const snapshot = commerce.snapshot();
        json(200, {
          rows: reconcileOrders(
            snapshot.sales,
            snapshot.invoices,
            snapshot.corrections,
            cash.active(),
            cash.activeRefunds(),
          ),
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/transport-damages') {
        const damages = transportStore.all();
        const used = new Set(
          damages.flatMap(({ outcome }) =>
            outcome?.kind === 'replacement' ? [outcome.receiptId] : [],
          ),
        );
        json(200, {
          damages:
            actor.role === 'editor'
              ? damages.map((damage) => ({
                  ...damage,
                  replacementCandidates: transport.replacementCandidates(damage, used),
                }))
              : damages,
          purchases: purchaseStore.all(),
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/tariffs') {
        const batches = tariffStore.latest();
        const products = store.products();
        const decisions = tariffStore.decisions().flatMap((decision) => {
          const batch = batches.find((item) => item.id === decision.tariffId);
          if (!batch) return [];
          const input = tariffDecisionInput(batch, products);
          return [
            { ...decision, stale: !input.current || input.fingerprint !== decision.fingerprint },
          ];
        });
        json(200, {
          batches,
          decisions,
          priceHistory: tariffStore.offerHistory(),
          suppliers: supplierStore.suppliers(),
          offers: supplierOffers.all(),
        });
        return;
      }
      const tariffSource = /^\/api\/tariff-sources\/([\w-]+)$/.exec(url.pathname);
      if (req.method === 'GET' && tariffSource?.[1]) {
        const source = tariffStore.source(tariffSource[1]);
        const original = tariffStore.original(tariffSource[1]);
        if (!source || !(original instanceof Uint8Array))
          fail(404, 'SOURCE_MISSING', 'Documento no encontrado.');
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition':
            'attachment; filename="tarifa-proveedor.' +
            (source.format === 'pdf' ? 'pdf' : 'txt') +
            '"',
          'Cache-Control': 'no-store',
        });
        res.end(Buffer.from(original));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/cash') {
        json(200, cash.report());
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/economics') {
        const selected = period(url.searchParams.get('from'), url.searchParams.get('to'));
        json(
          200,
          economicReport(commerce.snapshot().sales, expenses.all(), selected.from, selected.to),
        );
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/workspace') {
        const products = store.products();
        const proposals = store.proposals();
        json(200, {
          actor,
          scenario: process.env.CHANGELAB_SCENARIO ?? null,
          scenarioPeriod:
            process.env.CHANGELAB_SCENARIO &&
            validDate(process.env.CHANGELAB_SCENARIO_FROM) &&
            validDate(process.env.CHANGELAB_SCENARIO_TO)
              ? { from: process.env.CHANGELAB_SCENARIO_FROM, to: process.env.CHANGELAB_SCENARIO_TO }
              : null,
          ...commerce.snapshot(),
          stockReviewCount: stockSnapshot().rows.filter((r) =>
            r.signals.some((s) => ['out-of-stock', 'reorder'].includes(s.code)),
          ).length,
          suppliers: supplierStore.suppliers(),
          products,
          categories: [...new Set(products.map((p) => p.category))],
          orders: store.orders(),
          proposals,
          audit: store.audit().map((event) => ({
            ...event,
            summary: describeAudit({ action: event.action, detail: event.detail }, proposals, {
              hash: sha,
            }),
          })),
          identityNames: store.identityNames(),
          auditValid: store.verifyAudit(),
          planner: await generator.status(),
        });
        return;
      }

      const draftMatch = /^\/api\/billing\/drafts\/([\w-]+)$/.exec(url.pathname);
      if (req.method === 'GET' && draftMatch?.[1]) {
        const draft = commerce.draft(draftMatch[1]);
        if (!draft) fail(404, 'DRAFT_NOT_FOUND', 'Borrador no encontrado.');
        json(200, {
          draft,
          invoice: commerce.invoiceForDraft(draft.id),
          correction: commerce.invoiceForDraft(draft.id)
            ? commerce.correctionForInvoice(commerce.invoiceForDraft(draft.id)!.id)
            : undefined,
          actor,
          revisions: commerce.draftHistory(draft.id),
          orderCancelled: ['cancelled', 'returned'].includes(
            commerce.sale(draft.orderId)?.status ?? '',
          ),
        });
        return;
      }
      const reviewMatch = /^\/api\/proposals\/([\w-]+)\/review$/.exec(url.pathname);
      if (req.method === 'GET' && reviewMatch?.[1]) {
        json(200, service.review(reviewMatch[1]));
        return;
      }
      if (req.method !== 'POST') fail(404, 'NOT_FOUND', 'Ruta no disponible.');

      const tariffDecision = /^\/api\/tariffs\/([\w-]+)\/decision$/.exec(url.pathname);
      if (tariffDecision?.[1]) {
        if (actor.role !== 'editor')
          fail(403, 'FORBIDDEN', 'Solo Oficina o Dirección pueden preparar la propuesta.');
        const id = tariffDecision[1];
        const batch = tariffStore.batch(id);
        if (!batch) fail(404, 'TARIFF_NOT_FOUND', 'Tarifa no encontrada.');
        if (Object.keys(body).join(',') !== 'digest' || body.digest !== batch.digest)
          fail(409, 'TARIFF_DIGEST', 'Revisa la versión exacta de la tarifa.');
        if (batch.status === 'blocked')
          fail(409, 'TARIFF_BLOCKED', 'Corrige la tarifa antes de preparar una propuesta.');
        assertTariffDecisionSource(batch);
        const input = tariffDecisionInput(batch);
        if (!input.current)
          fail(409, 'TARIFF_CHANGED', 'La tarifa ya no coincide con los datos vigentes.');
        const saved = tariffStore.decision(id);
        if (saved?.fingerprint === input.fingerprint) {
          json(200, saved);
          return;
        }
        if (tariffDecisionPending.has(id))
          fail(
            409,
            'TARIFF_DECISION_PENDING',
            'Ya se está preparando una propuesta para esta tarifa.',
          );
        tariffDecisionPending.add(id);
        try {
          const report = await prepareTariffProposal(
            batch,
            input.products,
            commercialAI.explainTariff?.bind(commercialAI),
          );
          const decision = store.transaction(() => {
            const latest = tariffStore.batch(id);
            if (!latest || tariffDecisionInput(latest).fingerprint !== input.fingerprint)
              fail(
                409,
                'TARIFF_CHANGED',
                'Los datos cambiaron durante la simulación. Vuelve a preparar la propuesta.',
              );
            assertTariffDecisionSource(latest);
            const concurrent = tariffStore.decision(id);
            if (concurrent?.fingerprint === input.fingerprint) return concurrent;
            const value = {
              tariffId: id,
              fingerprint: input.fingerprint,
              createdBy: actor.id,
              createdAt: store.timestamp(),
              report,
            };
            tariffStore.saveDecision(value);
            store.record(actor.id, 'tariff.decision-prepared', {
              id,
              fingerprint: input.fingerprint,
              modelUsed: report.summary.modelUsed,
            });
            return value;
          });
          json(201, decision);
        } finally {
          tariffDecisionPending.delete(id);
        }
        return;
      }
      if (url.pathname === '/api/tariffs') {
        json(201, tariffs.preview(actor, body));
        return;
      }
      if (url.pathname === '/api/tariff-documents') {
        if (actor.role !== 'editor') fail(403, 'FORBIDDEN', 'Solo edición puede importar tarifas.');
        if (
          Object.keys(body).some(
            (k) =>
              ![
                'supplierId',
                'reference',
                'format',
                'source',
                'filename',
                'origin',
                'useAI',
                'reason',
                'reviewedCsv',
                'confirmReviewed',
              ].includes(k),
          ) ||
          typeof body.filename !== 'string' ||
          body.filename.length > 180 ||
          typeof body.origin !== 'string' ||
          body.origin.length > 300 ||
          (body.useAI !== undefined && typeof body.useAI !== 'boolean')
        )
          fail(400, 'INVALID_TARIFF_DOCUMENT', 'Revisa nombre y origen del documento.');
        const manual = body.reviewedCsv !== undefined;
        if (manual ? body.confirmReviewed !== true : body.confirmReviewed !== undefined)
          fail(
            400,
            'REVIEW_REQUIRED',
            'Confirma que cotejaste los costes unitarios con el original.',
          );
        if (tariffExtracting)
          fail(429, 'TARIFF_BUSY', 'Hay otro documento procesándose. Espera a que termine.');
        tariffExtracting = true;
        try {
          const source = await documentText(body);
          const extracted = manual
            ? { rows: parseTariffCsv(body.reviewedCsv), modelUsed: false }
            : await extractTariffRows(
                source,
                body.useAI === true ? (text) => commercialAI.extract(text) : undefined,
              );
          const original =
            body.format === 'pdf'
              ? Buffer.from(String(body.source), 'base64')
              : Buffer.from(String(body.source), 'utf8');
          const provenance = {
            id: randomUUID(),
            filename: body.filename,
            format: String(body.format),
            origin: body.origin,
            uploadedBy: actor.id,
            uploadedAt: new Date().toISOString(),
            sha256: createHash('sha256').update(original).digest('hex'),
            text: source,
            modelUsed: extracted.modelUsed,
            ...(manual ? { reviewedManually: true as const } : {}),
          };
          if (typeof body.supplierId === 'string' && typeof body.reference === 'string') {
            const prior = tariffStore.existing(body.supplierId, body.reference.trim());
            if (prior) {
              if (
                prior.createdBy === actor.id &&
                prior.source?.sha256 === provenance.sha256 &&
                Boolean(prior.source.reviewedManually) === manual &&
                JSON.stringify(prior.rows.map(({ sku, costCents }) => ({ sku, costCents }))) ===
                  JSON.stringify(extracted.rows)
              ) {
                json(200, prior);
                return;
              }
              fail(409, 'TARIFF_REFERENCE', 'Referencia de tarifa utilizada con otro documento.');
            }
          }
          json(
            201,
            store.transaction(() => {
              tariffStore.saveSource(provenance, original);
              return tariffs.preview(actor, {
                supplierId: body.supplierId,
                reference: body.reference,
                target: 'supplier-offer',
                sourceId: provenance.id,
                ...(body.reason !== undefined ? { reason: body.reason } : {}),
                csv:
                  'sku;coste\n' +
                  extracted.rows
                    .map((row) => row.sku + ';' + (row.costCents / 100).toFixed(2))
                    .join('\n'),
              });
            }),
          );
          return;
        } finally {
          tariffExtracting = false;
        }
      }
      const tariffMatch = /^\/api\/tariffs\/([\w-]+)\/apply$/.exec(url.pathname);
      if (tariffMatch?.[1]) {
        json(200, tariffs.apply(actor, tariffMatch[1], body));
        return;
      }
      if (url.pathname === '/api/campaigns/compare') {
        json(200, compareCampaigns(store.products(), body, sha));
        return;
      }
      if (url.pathname === '/api/campaigns/proposal') {
        if (actor.role !== 'editor')
          fail(403, 'FORBIDDEN', 'Solo edición puede preparar propuestas.');
        if (
          Object.keys(body).some(
            (k) => !['campaign', 'contextHash', 'index', 'reason'].includes(k),
          ) ||
          !body.campaign ||
          typeof body.campaign !== 'object' ||
          Array.isArray(body.campaign) ||
          !Number.isInteger(body.index) ||
          typeof body.reason !== 'string' ||
          body.reason.trim().length < 5 ||
          body.reason.length > 300
        )
          fail(400, 'INVALID_CAMPAIGN', 'Revisa alternativa y motivo.');
        const comparison = compareCampaigns(
          store.products(),
          body.campaign as Record<string, unknown>,
          sha,
        );
        if (body.contextHash !== comparison.contextHash)
          fail(409, 'CAMPAIGN_STALE', 'El catálogo cambió. Vuelve a comparar.');
        const alternative = comparison.alternatives[body.index as number];
        if (!alternative) fail(400, 'INVALID_CAMPAIGN', 'Alternativa no válida.');
        json(
          201,
          service.create(actor, {
            plan: { category: comparison.category, basisPoints: alternative.basisPoints },
            instruction:
              'Campaña ' +
              comparison.title +
              ' (' +
              comparison.from +
              ' a ' +
              comparison.to +
              '), fechas de referencia SIN programación automática. ' +
              body.reason.trim(),
          }),
        );
        return;
      }
      const stockPolicyMatch = /^\/api\/stock-policies\/([\w-]+)$/.exec(url.pathname);
      if (stockPolicyMatch?.[1]) {
        json(200, configureStockPolicy.execute(actor, stockPolicyMatch[1], body));
        return;
      }
      if (url.pathname === '/api/business-proposals') {
        if (actor.role !== 'editor')
          fail(403, 'FORBIDDEN', 'Solo una cuenta editora puede preparar simulaciones.');
        const snapshot = contextSnapshot();
        if (typeof body.contextHash !== 'string' || body.contextHash !== snapshot.contextHash)
          fail(409, 'CONTEXT_CHANGED', 'Los datos han cambiado. Actualiza el análisis.');
        json(201, service.create(actor, businessProposalInput(snapshot.context, body)));
        return;
      }
      if (url.pathname === '/api/business-priorities') {
        if (
          Object.keys(body).some((key) => key !== 'contextHash') ||
          typeof body.contextHash !== 'string'
        )
          fail(400, 'INVALID_CONTEXT', 'Revisa los datos antes de priorizar.');
        const snapshot = contextSnapshot();
        if (snapshot.contextHash !== body.contextHash)
          fail(409, 'CONTEXT_CHANGED', 'Los datos han cambiado. Actualiza antes de priorizar.');
        if (ranking) fail(429, 'BUSINESS_BUSY', 'Hay una priorización en curso.');
        ranking = true;
        try {
          const result = await trackedRanking.execute(
            actor.id,
            snapshot,
            businessRanker,
            () => contextSnapshot().contextHash,
          );
          json(200, result);
        } finally {
          ranking = false;
        }
        return;
      }
      const supplierMatch = /^\/api\/suppliers\/([\w-]+)$/.exec(url.pathname);
      if (url.pathname === '/api/suppliers' || supplierMatch?.[1]) {
        json(200, manageSuppliers.execute(actor, supplierMatch?.[1], body));
        return;
      }
      const catalogMatch = /^\/api\/catalog-management\/([\w-]+)$/.exec(url.pathname);
      if (url.pathname === '/api/catalog-management' || catalogMatch?.[1]) {
        json(200, catalogManagement.execute(actor, catalogMatch?.[1], body));
        return;
      }
      const returnMatch = /^\/api\/orders\/([\w-]+)\/return$/.exec(url.pathname);
      if (returnMatch?.[1]) {
        json(201, warehouse.returnAll(actor, returnMatch[1], body));
        return;
      }
      if (url.pathname === '/api/inventory/adjustments') {
        json(201, warehouse.adjust(actor, body));
        return;
      }
      if (url.pathname === '/api/transport-damages') {
        json(201, transport.create(actor, body));
        return;
      }
      if (url.pathname === '/api/transport-damages/resolve') {
        json(200, transport.resolve(actor, body));
        return;
      }
      const reverseMatch = /^\/api\/cash\/([\w-]+)\/reverse$/.exec(url.pathname);
      if (reverseMatch?.[1]) {
        json(200, reverseCash.execute(actor, reverseMatch[1], body));
        return;
      }
      const refundReverseMatch = /^\/api\/refunds\/([\w-]+)\/reverse$/.exec(url.pathname);
      if (refundReverseMatch?.[1]) {
        json(200, reverseRefund.execute(actor, refundReverseMatch[1], body));
        return;
      }
      if (url.pathname === '/api/refunds') {
        json(201, registerRefund.execute(actor, body));
        return;
      }
      if (url.pathname === '/api/cash') {
        if (needsOwnerDecision(actor) && body.kind === 'payment') {
          const request = approvalStore.get(String(body.targetId));
          if (
            !request ||
            request.status !== 'approved' ||
            !store.db
              .prepare("SELECT 1 FROM user_business_roles WHERE userId=? AND businessRole='owner'")
              .get(request.decision?.actor ?? '')
          )
            fail(
              403,
              'OWNER_APPROVAL_REQUIRED',
              'El pago necesita un gasto autorizado por dirección.',
            );
        }
        json(201, registerCash.execute(actor, body));
        return;
      }
      const cancelExpenseMatch = /^\/api\/expenses\/([\w-]+)\/cancel$/.exec(url.pathname);
      if (cancelExpenseMatch?.[1]) {
        json(200, cancelExpense.execute(actor, cancelExpenseMatch[1], body));
        return;
      }
      if (url.pathname === '/api/expenses') {
        json(201, registerExpense.execute(actor, body));
        return;
      }
      const correctionMatch = /^\/api\/billing\/invoices\/([\w-]+)\/rectify$/.exec(url.pathname);
      if (correctionMatch?.[1]) {
        json(201, rectification.execute(actor, correctionMatch[1], body));
        return;
      }
      const issueMatch = /^\/api\/billing\/drafts\/([\w-]+)\/issue$/.exec(url.pathname);
      if (issueMatch?.[1]) {
        json(201, issuance.execute(actor, issueMatch[1], body));
        return;
      }
      const revisionMatch = /^\/api\/billing\/drafts\/([\w-]+)\/revise$/.exec(url.pathname);
      if (revisionMatch?.[1]) {
        json(200, revisions.execute(actor, revisionMatch[1], body));
        return;
      }
      const billingMatch = /^\/api\/orders\/([\w-]+)\/draft$/.exec(url.pathname);
      if (billingMatch?.[1]) {
        json(201, billing.execute(actor, billingMatch[1], body));
        return;
      }
      const statusMatch = /^\/api\/orders\/([\w-]+)\/status$/.exec(url.pathname);
      if (statusMatch?.[1]) {
        json(200, orderManagement.execute(actor, statusMatch[1], body));
        return;
      }
      const cancelReceiptMatch = /^\/api\/inventory\/receipts\/([\w-]+)\/cancel$/.exec(
        url.pathname,
      );
      if (cancelReceiptMatch?.[1]) {
        json(200, cancelReceipt.execute(actor, cancelReceiptMatch[1], body));
        return;
      }
      if (url.pathname === '/api/inventory/receipts') {
        json(201, receiving.execute(actor, body));
        return;
      }
      if (url.pathname === '/api/orders') {
        json(201, checkout.execute(actor, body));
        return;
      }
      if (url.pathname === '/api/plans') {
        if (actor.role !== 'editor')
          fail(403, 'FORBIDDEN', 'Solo una cuenta editora puede preparar un plan.');
        if (planning)
          fail(429, 'PLANNER_BUSY', 'Hay una interpretación en curso. Espera a que termine.');
        planning = true;
        try {
          json(200, await planner.execute(body.instruction));
        } finally {
          planning = false;
        }
        return;
      }
      if (url.pathname === '/api/proposals') {
        json(201, service.create(actor, body));
        return;
      }
      const scenarioMatch = /^\/api\/proposals\/([\w-]+)\/scenario$/.exec(url.pathname);
      if (scenarioMatch?.[1]) {
        json(200, service.scenario(scenarioMatch[1], body));
        return;
      }
      const publishMatch = /^\/api\/proposals\/([\w-]+)\/publish$/.exec(url.pathname);
      if (publishMatch?.[1]) {
        json(200, service.publish(actor, publishMatch[1], body.digest));
        return;
      }
      fail(404, 'NOT_FOUND', 'Ruta no disponible.');
    } catch (error) {
      if (error instanceof AppError)
        json(error.status, { error: error.code, message: error.message });
      else {
        console.error(error instanceof Error ? error.name : 'Internal error');
        json(500, { error: 'INTERNAL', message: 'No se pudo completar la operación.' });
      }
    }
  });
  // The web process captures locally; external delivery runs in the separate mail worker.
  const mailTimer =
    mailConfig.mode === 'preview'
      ? setInterval(() => {
          void mailPump.run().catch(() => console.error('Mail capture unavailable'));
        }, 2000)
      : undefined;
  mailTimer?.unref();
  server.once('close', () => {
    if (mailTimer) clearInterval(mailTimer);
  });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const store = new Store(process.env.CHANGELAB_DB ?? resolve(root, 'data', 'changelab.sqlite'));
  const server = makeServer(store),
    { host, port } = serverAddress();
  server.listen(port, host, () => console.log('ChangeLab · http://127.0.0.1:' + port));
  const stop = () =>
    server.close(() => {
      store.close();
      process.exit(0);
    });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
