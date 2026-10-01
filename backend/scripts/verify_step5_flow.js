import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

async function verifyStep5() {
  console.log('======================================================================');
  console.log('STEP 5: ADMIN ORDERS, INVENTORY & STOCK MANAGEMENT HARDENING TEST');
  console.log('======================================================================\n');

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer admin-secret',
  };

  const pId = '10000000-0000-0000-0000-000000000001'; // Groundnut Oil

  // Phase 1: Product & Variant Inspection
  console.log('--- 1. Inspect Existing Product with Multiple Variants ---');
  let prodRes = await fetch(`http://localhost:5000/api/products/${pId}`).then(r => r.json());
  console.log(`Product: ${prodRes.name} (${prodRes.tamil_name})`);
  console.log('Variants:');
  prodRes.variants.forEach(v => {
    console.log(`  - ${v.size} | Price: ₹${v.price} | Stock: ${v.stock}`);
  });

  const testVariantSize = '500 ml';
  const initialStock = prodRes.variants.find(v => v.size === testVariantSize)?.stock || 0;
  console.log(`Initial stock for ${testVariantSize}: ${initialStock}\n`);

  // Phase 2: Out of Stock Prevention
  console.log('--- 2. Out-of-Stock Variant Prevention (Stock = 0) ---');
  const oosPayload = {
    items: [{
      id: pId,
      name: prodRes.name,
      size: testVariantSize,
      price: 120,
      qty: 1,
    }],
    address_id: 'test-addr',
    payment_method: 'UPI',
  };

  const oosRes = await fetch('http://localhost:5000/api/payments/create-order', {
    method: 'POST',
    headers,
    body: JSON.stringify(oosPayload),
  });
  const oosData = await oosRes.json();
  console.log('Order creation with stock=0 status:', oosRes.status);
  console.log('Response message:', oosData.message);

  if (oosRes.status !== 400 || !oosData.message.includes('out of stock')) {
    throw new Error(`Expected 400 Out of Stock, got ${oosRes.status}: ${JSON.stringify(oosData)}`);
  }
  console.log('✅ Purchasing an out-of-stock variant was correctly blocked!\n');

  // Phase 3: Set Available Stock to 10 for Testing
  console.log('--- 3. Setting Stock of Variant for Controlled Testing ---');
  const updatedVariants = prodRes.variants.map(v => 
    v.size === testVariantSize ? { ...v, stock: 10 } : v
  );
  const updateRes = await fetch(`http://localhost:5000/api/products/${pId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      ...prodRes,
      variants: updatedVariants,
      stock: 10,
    }),
  });
  console.log('Admin product stock update status:', updateRes.status);
  if (!updateRes.ok) throw new Error('Failed to update product stock for testing');
  console.log(`✅ Set ${testVariantSize} stock to 10 units.\n`);

  // Phase 4: Overselling Prevention (Requested > Stock)
  console.log('--- 4. Overselling Prevention (Requested 15 > Stock 10) ---');
  const overPayload = {
    items: [{
      id: pId,
      name: prodRes.name,
      size: testVariantSize,
      price: 120,
      qty: 15,
    }],
    address_id: 'test-addr',
    payment_method: 'UPI',
  };

  const overRes = await fetch('http://localhost:5000/api/payments/create-order', {
    method: 'POST',
    headers,
    body: JSON.stringify(overPayload),
  });
  const overData = await overRes.json();
  console.log('Order creation with qty > stock status:', overRes.status);
  console.log('Response message:', overData.message);

  if (overRes.status !== 400 || !overData.message.includes('exceeds available stock')) {
    throw new Error(`Expected 400 Overselling rejection, got ${overRes.status}: ${JSON.stringify(overData)}`);
  }
  console.log('✅ Overselling request was correctly blocked!\n');

  // Phase 5: Quantity Within Available Stock (Requested 2 <= 10)
  console.log('--- 5. Quantity Within Available Stock (Requested 2 <= 10) ---');
  const validPayload = {
    items: [{
      id: pId,
      name: prodRes.name,
      size: testVariantSize,
      price: 120,
      qty: 2,
    }],
    address_id: 'test-addr',
    payment_method: 'UPI',
  };

  const validRes = await fetch('http://localhost:5000/api/payments/create-order', {
    method: 'POST',
    headers,
    body: JSON.stringify(validPayload),
  });
  const validData = await validRes.json();
  console.log('Valid checkout preparation status:', validRes.status);
  console.log('Order ID created:', validData.internalOrderId || validData.id);

  if (validRes.status !== 200 || !validData.id) {
    throw new Error(`Expected 200 checkout order creation, got ${validRes.status}`);
  }
  console.log('✅ Checkout preparation succeeded within stock limits!\n');

  // Phase 6: COD Order Flow and Variant Stock Reduction
  console.log('--- 6. COD Order Flow & Variant Stock Reduction ---');
  console.log(`Stock before COD order: 10`);
  const codRes = await fetch('http://localhost:5000/api/payments/test-cod-order', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      items: [{ id: pId, name: prodRes.name, size: testVariantSize, price: 120, qty: 2 }],
      address_id: 'test-addr',
    }),
  }).then(r => r.json());

  console.log('COD order placed:', codRes.message, '| OrderId:', codRes.orderId);
  
  // Verify stock reduced by 2 (10 -> 8)
  const afterCodProd = await fetch(`http://localhost:5000/api/products/${pId}`).then(r => r.json());
  const stockAfterCod = afterCodProd.variants.find(v => v.size === testVariantSize)?.stock;
  console.log(`Stock after COD order (2 units): ${stockAfterCod}`);

  if (stockAfterCod !== 8) {
    throw new Error(`Expected stock 8 after COD deduction, got ${stockAfterCod}`);
  }
  console.log('✅ COD order correctly reduced variant stock from 10 to 8!\n');

  // Phase 7: Razorpay Order Verification & Stock Reduction
  console.log('--- 7. Razorpay Order Flow & Stock Reduction ---');
  // Create order for 3 units
  const rzpOrderRes = await fetch('http://localhost:5000/api/payments/create-order', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      items: [{ id: pId, name: prodRes.name, size: testVariantSize, price: 120, qty: 3 }],
      address_id: 'test-addr',
      payment_method: 'UPI',
    }),
  }).then(r => r.json());

  const paymentId = `pay_${Date.now()}`;
  const secret = process.env.RAZORPAY_KEY_SECRET || 'secret';
  const body = `${rzpOrderRes.id}|${paymentId}`;
  const validSignature = crypto.createHmac('sha256', secret).update(body).digest('hex');

  console.log('Simulating payment verification for Razorpay order:', rzpOrderRes.internalOrderId);
  const verifyRes = await fetch('http://localhost:5000/api/payments/verify', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      orderId: rzpOrderRes.internalOrderId,
      razorpay_order_id: rzpOrderRes.id,
      razorpay_payment_id: paymentId,
      razorpay_signature: validSignature,
    }),
  }).then(r => r.json());

  console.log('Payment verification response:', verifyRes.message);

  // Verify stock reduced by 3 (8 -> 5)
  const afterRzpProd = await fetch(`http://localhost:5000/api/products/${pId}`).then(r => r.json());
  const stockAfterRzp = afterRzpProd.variants.find(v => v.size === testVariantSize)?.stock;
  console.log(`Stock after Razorpay payment verification: ${stockAfterRzp}`);

  if (stockAfterRzp !== 5) {
    throw new Error(`Expected stock 5 after Razorpay payment deduction, got ${stockAfterRzp}`);
  }
  console.log('✅ Razorpay order payment correctly reduced variant stock from 8 to 5!\n');

  // Phase 8: Order Cancellation and Stock Restoration
  console.log('--- 8. Order Cancellation & Stock Restoration ---');
  console.log(`Current stock: 5 units. Cancelling order ${rzpOrderRes.internalOrderId}...`);
  const cancelRes = await fetch(`http://localhost:5000/api/orders/${rzpOrderRes.internalOrderId}/status`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ status: 'cancelled' }),
  });
  console.log('Cancel order status:', cancelRes.status);

  // Check restored stock: should be 5 + 3 = 8
  const afterCancelProd = await fetch(`http://localhost:5000/api/products/${pId}`).then(r => r.json());
  const stockAfterCancel = afterCancelProd.variants.find(v => v.size === testVariantSize)?.stock;
  console.log(`Stock after cancellation restoration: ${stockAfterCancel}`);

  if (stockAfterCancel !== 8) {
    throw new Error(`Expected stock 8 after cancellation restoration, got ${stockAfterCancel}`);
  }
  console.log('✅ Order cancellation safely restored the 3 units back to inventory!\n');

  // Phase 9: Restore Original Stock Value (0)
  console.log('--- 9. Cleaning up test stock back to authentic baseline ---');
  const restoreVariants = prodRes.variants.map(v => 
    v.size === testVariantSize ? { ...v, stock: initialStock } : v
  );
  await fetch(`http://localhost:5000/api/products/${pId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      ...prodRes,
      variants: restoreVariants,
      stock: initialStock,
    }),
  });
  const finalProd = await fetch(`http://localhost:5000/api/products/${pId}`).then(r => r.json());
  console.log(`Baseline stock restored: ${finalProd.variants.find(v => v.size === testVariantSize)?.stock}`);
  console.log('✅ Database and catalog stock preserved in original authentic state!\n');

  console.log('======================================================================');
  console.log('🎉 ALL STEP 5 INVENTORY, ORDERS & STOCK HARDENING TESTS PASSED!');
  console.log('======================================================================');
}

verifyStep5().catch(err => {
  console.error('❌ Step 5 Verification Error:', err);
  process.exit(1);
});
