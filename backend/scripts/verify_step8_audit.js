import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

async function runStep8Audit() {
  console.log('======================================================================');
  console.log('STEP 8: PRODUCTION READINESS, SECURITY & RELIABILITY AUDIT');
  console.log('======================================================================\n');

  const adminHeaders = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer admin-secret',
  };

  const p1Id = '10000000-0000-0000-0000-000000000001'; // Groundnut Oil

  // Audit 1: Admin Endpoint Authorization
  console.log('--- 1. Admin Endpoint Authorization & Access Control ---');
  // 1a: No token provided
  const noAuthRes = await fetch('http://localhost:5000/api/admin/stats');
  console.log('  1a. Request without token status:', noAuthRes.status);
  if (noAuthRes.status !== 401) {
    throw new Error(`Expected 401 Unauthorized for missing token, got ${noAuthRes.status}`);
  }

  // 1b: Valid Admin token
  const adminRes = await fetch('http://localhost:5000/api/admin/stats', { headers: adminHeaders });
  console.log('  1b. Request with admin credentials status:', adminRes.status);
  if (adminRes.status !== 200) {
    throw new Error(`Expected 200 OK for admin credentials, got ${adminRes.status}`);
  }
  console.log('✅ Admin API endpoints are strictly protected from unauthenticated access!\n');

  // Audit 2: Price Tampering Defense (Authoritative DB Pricing)
  console.log('--- 2. Price Tampering Defense (Frontend Price Overridden by DB) ---');
  // First set temporary stock so order creation passes stock check
  const p1Res = await fetch(`http://localhost:5000/api/products/${p1Id}`).then(r => r.json());
  const initialVariants = p1Res.variants;
  const testStockVariants = initialVariants.map(v => v.size === '500 ml' ? { ...v, stock: 5 } : v);
  await fetch(`http://localhost:5000/api/products/${p1Id}`, {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({ ...p1Res, variants: testStockVariants, stock: 5 }),
  });

  // Client attempts to send fake price ₹1 instead of real price ₹120
  const tamperedOrderRes = await fetch('http://localhost:5000/api/payments/create-order', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      items: [{ id: p1Id, size: '500 ml', qty: 2, price: 1.00 }], // Tampered price
      address_id: 'test-addr',
    }),
  }).then(r => r.json());

  // Backend should recalculate subtotal = 2 * 120 = 240, Taxable = 240, GST = 12, Shipping = 60, Total = 312 (31200 paise)
  console.log('  Tampered order submitted with price: ₹1');
  console.log('  Backend generated Razorpay Amount (paise):', tamperedOrderRes.amount);
  if (tamperedOrderRes.amount !== 31200) {
    throw new Error(`Price tampering not prevented! Expected amount 31200 paise (₹312), got ${tamperedOrderRes.amount}`);
  }
  console.log('✅ Price tampering prevented! Backend strictly enforced authoritative database pricing.\n');

  // Audit 3: Direct API Bypass Rejections (Empty Cart, Out-of-Stock, Non-existent Product)
  console.log('--- 3. Direct API Bypass Rejections ---');
  // 3a: Empty cart
  const emptyRes = await fetch('http://localhost:5000/api/payments/create-order', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ items: [] }),
  });
  console.log('  3a. Empty cart status:', emptyRes.status);
  if (emptyRes.status !== 400) throw new Error('Empty cart was not rejected with 400');

  // 3b: Out of stock variant (1 Litre has stock = 0)
  const oosRes = await fetch('http://localhost:5000/api/payments/create-order', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      items: [{ id: p1Id, size: '1 Litre', qty: 1 }],
      address_id: 'test-addr',
    }),
  });
  console.log('  3b. Out-of-stock variant status:', oosRes.status);
  if (oosRes.status !== 400) throw new Error('Out of stock variant was not rejected with 400');

  // 3c: Non-existent product
  const notFoundRes = await fetch('http://localhost:5000/api/payments/create-order', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      items: [{ id: '99999999-9999-9999-9999-999999999999', size: '500 ml', qty: 1 }],
      address_id: 'test-addr',
    }),
  });
  console.log('  3c. Non-existent product status:', notFoundRes.status);
  if (notFoundRes.status !== 404) throw new Error('Non-existent product was not rejected with 404');
  console.log('✅ All direct bypass attempts safely blocked with proper HTTP status codes!\n');

  // Audit 4: Razorpay Payment HMAC-SHA256 Security
  console.log('--- 4. Razorpay HMAC-SHA256 Security & Signature Integrity ---');
  const paymentId = `pay_${Date.now()}`;
  const validSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'secret')
    .update(`${tamperedOrderRes.id}|${paymentId}`)
    .digest('hex');

  // 4a: Tampered signature rejection
  const badSigRes = await fetch('http://localhost:5000/api/payments/verify', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      orderId: tamperedOrderRes.internalOrderId,
      razorpay_order_id: tamperedOrderRes.id,
      razorpay_payment_id: paymentId,
      razorpay_signature: 'fake_tampered_signature_abc123',
    }),
  });
  console.log('  4a. Tampered signature verification status:', badSigRes.status);
  if (badSigRes.status !== 400) {
    throw new Error(`Expected 400 for tampered signature, got ${badSigRes.status}`);
  }

  // 4b: Authentic signature acceptance
  const goodSigRes = await fetch('http://localhost:5000/api/payments/verify', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      orderId: tamperedOrderRes.internalOrderId,
      razorpay_order_id: tamperedOrderRes.id,
      razorpay_payment_id: paymentId,
      razorpay_signature: validSignature,
    }),
  });
  console.log('  4b. Authentic signature verification status:', goodSigRes.status);
  if (goodSigRes.status !== 200) {
    throw new Error(`Expected 200 for authentic signature, got ${goodSigRes.status}`);
  }
  console.log('✅ Razorpay HMAC-SHA256 signature verification confirmed 100% secure!\n');

  // Audit 5: Double-Restoration Prevention
  console.log('--- 5. Inventory Restoration Idempotency & Double-Restoration Prevention ---');
  // First cancellation: restores the 2 units (stock 3 -> 5)
  await fetch(`http://localhost:5000/api/orders/${tamperedOrderRes.internalOrderId}/status`, {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({ status: 'cancelled' }),
  });
  const afterCancel1 = await fetch(`http://localhost:5000/api/products/${p1Id}`).then(r => r.json());
  const s1 = afterCancel1.variants.find(v => v.size === '500 ml')?.stock;
  console.log(`  Stock after 1st cancellation: ${s1} (expected 5)`);

  // Second cancellation attempt on same order
  await fetch(`http://localhost:5000/api/orders/${tamperedOrderRes.internalOrderId}/status`, {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({ status: 'cancelled' }),
  });
  const afterCancel2 = await fetch(`http://localhost:5000/api/products/${p1Id}`).then(r => r.json());
  const s2 = afterCancel2.variants.find(v => v.size === '500 ml')?.stock;
  console.log(`  Stock after 2nd cancellation attempt: ${s2} (expected 5)`);

  if (s2 !== 5) {
    throw new Error(`Double-restoration bug detected! Stock became ${s2}`);
  }
  console.log('✅ Inventory cancellation restoration is strictly idempotent!\n');

  // Audit 6: Cleanup Test Stock to Baseline (0)
  console.log('--- 6. Restoring Authentic Baseline Catalog Stock (0) ---');
  const cleanVariants = initialVariants.map(v => ({ ...v, stock: 0 }));
  await fetch(`http://localhost:5000/api/products/${p1Id}`, {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({ ...p1Res, variants: cleanVariants, stock: 0 }),
  });
  console.log('✅ Baseline authentic catalog inventory preserved.\n');

  // Audit 7: Final Catalog Integrity Check
  console.log('--- 7. Final Product & Variant Counts ---');
  const finalCat = await fetch('http://localhost:5000/api/products?limit=100').then(r => r.json());
  const prods = finalCat.products || [];
  let varsCount = 0;
  prods.forEach(p => varsCount += (p.variants || []).length);
  console.log(`Total Products: ${prods.length} (Expected: 29)`);
  console.log(`Total Variants: ${varsCount} (Expected: 64)`);

  if (prods.length !== 29 || varsCount !== 64) {
    throw new Error(`Catalog count mismatch! Products: ${prods.length}, Variants: ${varsCount}`);
  }
  console.log('✅ Exact 29 products and 64 variants confirmed!\n');

  console.log('======================================================================');
  console.log('🎉 STEP 8 PRODUCTION READINESS, SECURITY & RELIABILITY AUDIT PASSED!');
  console.log('======================================================================');
}

runStep8Audit().catch(err => {
  console.error('❌ Step 8 Audit Error:', err);
  process.exit(1);
});
