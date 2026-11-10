import { checkChanges, type Finding, type Product } from '../domain/catalog.ts';
import type { TariffBatch } from './tariffs.ts';

const MAX_PRICE_CENTS = 100_000_000;

export type TariffExplanationOption = {
  code: 'REVIEW_REQUIRED' | 'ABSORB_BELOW_MINIMUM' | 'COMPARE_SCENARIOS';
  text: string;
};

function marginBps(priceCents: number, costCents: number) {
  return Math.floor(((priceCents - costCents) * 10_000) / priceCents);
}

const money = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const percent = new Intl.NumberFormat('es-ES', { style: 'percent', maximumFractionDigits: 2 });
const safeSku = (sku: string) => (/^[a-z0-9_-]{2,60}$/i.test(sku) ? sku : 'un artículo');

function scenario(product: Product, priceCents: number | null, costCents: number) {
  if (priceCents === null)
    return {
      priceCents,
      marginBps: null,
      findings: [
        {
          code: 'INVALID_PRICE',
          productId: product.id,
          message: 'El precio para conservar el margen supera el máximo admitido en el catálogo.',
        },
      ],
    };
  const hypothetical = { ...product, costCents };
  return {
    priceCents,
    marginBps: marginBps(priceCents, costCents),
    findings: checkChanges(
      [hypothetical],
      [
        {
          productId: product.id,
          name: product.name,
          baseVersion: product.version,
          beforeCents: product.priceCents,
          afterCents: priceCents,
          costCents,
        },
      ],
    ),
  };
}

function preservingPrice(priceCents: number, beforeCostCents: number, afterCostCents: number) {
  // Redondeamos al céntimo superior para conservar el margen de referencia.
  const denominator = BigInt(beforeCostCents);
  const price = (BigInt(priceCents) * BigInt(afterCostCents) + denominator - 1n) / denominator;
  return price <= BigInt(MAX_PRICE_CENTS) ? Number(price) : null;
}

/** Calcula los escenarios con el coste del proveedor que figura en la tarifa. */
export async function prepareTariffProposal(
  batch: TariffBatch,
  products: Product[],
  explain?: (options: TariffExplanationOption[]) => Promise<unknown>,
) {
  const source = {
    tariffId: batch.id,
    digest: batch.digest,
    supplierId: batch.supplierId,
    supplierName: batch.supplierName,
    reference: batch.reference,
    status: batch.status,
    ...(batch.source ? { sourceId: batch.source.id, sourceSha256: batch.source.sha256 } : {}),
  };
  const findings: Finding[] = [];
  if (batch.status === 'blocked')
    findings.push({
      code: 'TARIFF_BLOCKED',
      productId: '',
      message: 'La tarifa está bloqueada. Revisa sus referencias antes de tomar una decisión.',
    });
  if (!batch.changes.length)
    findings.push({
      code: 'NO_TARIFF_CHANGES',
      productId: '',
      message: 'La tarifa no contiene cambios de coste para comparar.',
    });

  const rows = batch.changes.flatMap((change) => {
    const product = products.find((candidate) => candidate.id === change.productId);
    if (!product) {
      findings.push({
        code: 'MISSING_PRODUCT',
        productId: change.productId,
        message: change.sku + ': el producto está archivado o no está disponible.',
      });
      return [];
    }
    const amounts = [product.priceCents, change.beforeCostCents, change.afterCostCents];
    if (
      amounts.some(
        (amount) => !Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_PRICE_CENTS,
      )
    ) {
      findings.push({
        code: 'INVALID_AMOUNT',
        productId: product.id,
        message: change.sku + ': hay importes no válidos para calcular el escenario.',
      });
      return [];
    }
    return [
      {
        productId: product.id,
        sku: change.sku,
        name: product.name,
        baseVersion: change.baseVersion,
        productVersion: product.version,
        referencePriceCents: product.priceCents,
        beforeCostCents: change.beforeCostCents,
        afterCostCents: change.afterCostCents,
        previousMarginBps: marginBps(product.priceCents, change.beforeCostCents),
        absorb: scenario(product, product.priceCents, change.afterCostCents),
        preserve: scenario(
          product,
          preservingPrice(product.priceCents, change.beforeCostCents, change.afterCostCents),
          change.afterCostCents,
        ),
      },
    ];
  });

  const options: TariffExplanationOption[] = [];
  const preserveWarning = rows.find((row) => row.preserve.findings.length);
  if (preserveWarning) findings.push(...preserveWarning.preserve.findings);
  if (findings.length || preserveWarning)
    options.push({
      code: 'REVIEW_REQUIRED',
      text: preserveWarning
        ? safeSku(preserveWarning.sku) +
          (preserveWarning.preserve.priceCents === null
            ? ' supera el precio máximo admitido si se conserva el margen de referencia.'
            : ' seguiría por debajo del margen mínimo al conservar su margen de referencia.')
        : 'Revisa los avisos de la tarifa antes de tomar una decisión.',
    });
  const belowMinimum = rows.filter((row) =>
    row.absorb.findings.some((finding) => finding.code === 'MIN_MARGIN'),
  );
  const worst = belowMinimum.toSorted((a, b) => a.absorb.marginBps! - b.absorb.marginBps!)[0];
  if (worst) {
    const text =
      safeSku(worst.sku) +
      ' quedaría con un margen bruto del ' +
      percent.format(worst.absorb.marginBps! / 10_000) +
      ' si se mantiene el precio neto de ' +
      money.format(worst.referencePriceCents / 100) +
      '. Está por debajo del mínimo del 20 %.';
    options.push({
      code: 'ABSORB_BELOW_MINIMUM',
      text,
    });
    findings.push({ code: 'ABSORB_BELOW_MINIMUM', productId: worst.productId, message: text });
  }
  const largestAdjustment = rows
    .filter((row) => row.preserve.priceCents !== null)
    .toSorted(
      (a, b) =>
        Math.abs(b.preserve.priceCents! - b.referencePriceCents) -
        Math.abs(a.preserve.priceCents! - a.referencePriceCents),
    )[0];
  if (largestAdjustment)
    options.push({
      code: 'COMPARE_SCENARIOS',
      text:
        safeSku(largestAdjustment.sku) +
        ' tiene un precio neto de ' +
        money.format(largestAdjustment.referencePriceCents / 100) +
        '. Para conservar su margen de referencia del ' +
        percent.format(largestAdjustment.previousMarginBps / 10_000) +
        ' con el nuevo coste, el escenario calcula ' +
        money.format(largestAdjustment.preserve.priceCents! / 100) +
        ' netos.',
    });

  let summary = { ...options[0]!, modelUsed: false };
  if (explain) {
    try {
      const choice = await explain(options.map((option) => ({ ...option })));
      if (
        choice &&
        typeof choice === 'object' &&
        !Array.isArray(choice) &&
        Object.keys(choice).length === 1 &&
        Object.hasOwn(choice, 'code')
      ) {
        const selected = options.find(
          (option) => option.code === (choice as { code: unknown }).code,
        );
        if (selected) summary = { ...selected, modelUsed: true };
      }
    } catch {
      // The deterministic analysis is available if the optional model fails.
    }
  }
  return { source, rows, findings, summary };
}
