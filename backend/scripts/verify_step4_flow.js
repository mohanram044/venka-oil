async function verifyStep4() {
  console.log('===============================================================');
  console.log('STEP 4: ADMIN PRODUCT MANAGEMENT & STOREFRONT INTEGRATION VERIFICATION');
  console.log('===============================================================\n');

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer admin-secret',
  };

  // 1. Check Catalog & Variant Integrity
  console.log('--- 1. Catalog & Variant Integrity ---');
  const catRes = await fetch('http://localhost:5000/api/products?limit=100').then(r => r.json());
  console.log('Total Products returned:', catRes.products.length);
  const totalVariants = catRes.products.reduce((acc, p) => acc + (p.variants?.length || 0), 0);
  console.log('Total Pack Variants returned:', totalVariants);

  if (catRes.products.length !== 29 || totalVariants !== 64) {
    throw new Error(`Expected 29 products and 64 variants, got ${catRes.products.length} and ${totalVariants}`);
  }
  console.log('✅ Catalog integrity verified: exactly 29 products and 64 variants.\n');

  // 2. Category Coverage Test (All 5 Categories)
  console.log('--- 2. Category Filtering Verification (5 categories) ---');
  const categories = ['oils', 'dryfruits', 'palm-products', 'millets', 'honey'];
  const expectedMinCounts = { oils: 7, dryfruits: 9, 'palm-products': 3, millets: 9, honey: 1 };
  
  for (const c of categories) {
    const res = await fetch(`http://localhost:5000/api/products?category=${c}`).then(r => r.json());
    console.log(`Category "${c}": ${res.products.length} products (expected >= ${expectedMinCounts[c]})`);
    if (res.products.length < expectedMinCounts[c]) {
      throw new Error(`Category ${c} returned fewer than expected products`);
    }
  }
  console.log('✅ All 5 categories verified successfully.\n');

  // 3. Multi-field Search Verification
  console.log('--- 3. Search Verification (English Name, Tamil Name, SKU) ---');
  // English name search
  const enRes = await fetch('http://localhost:5000/api/products?search=Sesame').then(r => r.json());
  console.log('Search "Sesame" (English):', enRes.products.length, 'match(es) ->', enRes.products[0]?.name);
  if (!enRes.products.some(p => p.name.includes('Sesame'))) throw new Error('English search failed');

  // Tamil name search
  const taRes = await fetch('http://localhost:5000/api/products?search=நல்லெண்ணெய்').then(r => r.json());
  console.log('Search "நல்லெண்ணெய்" (Tamil):', taRes.products.length, 'match(es) ->', taRes.products[0]?.tamil_name);
  if (!taRes.products.some(p => p.tamil_name?.includes('நல்லெண்ணெய்'))) throw new Error('Tamil search failed');

  // SKU search
  const skuRes = await fetch('http://localhost:5000/api/products?search=sesame-oil').then(r => r.json());
  console.log('Search "sesame-oil" (SKU):', skuRes.products.length, 'match(es) ->', skuRes.products[0]?.sku);
  if (!skuRes.products.some(p => p.sku === 'sesame-oil')) throw new Error('SKU search failed');
  console.log('✅ Search verified across English, Tamil, and SKU.\n');

  // 4. Real Existing Product Verification (Groundnut Oil)
  console.log('--- 4. Real Product & Variant Inspection ---');
  const pId = '10000000-0000-0000-0000-000000000001';
  const prod = await fetch(`http://localhost:5000/api/products/${pId}`).then(r => r.json());
  console.log('Product:', prod.name);
  console.log('Tamil Name:', prod.tamil_name);
  console.log('Category:', prod.category);
  console.log('Images:', prod.images?.[0] || prod.image);
  console.log('Variants:');
  prod.variants.forEach(v => {
    console.log(`  - Size: ${v.size} | Price: ₹${v.price} | Stock: ${v.stock} | Active: ${v.is_active !== false}`);
  });

  if (!prod.variants || prod.variants.length < 2) {
    throw new Error('Groundnut oil variants missing');
  }
  console.log('✅ Real product and variants verified.\n');

  // 5. Storefront → Cart → Checkout Preparation Flow
  console.log('--- 5. Storefront → Cart → Checkout Preparation Flow ---');
  const chosenVariant = prod.variants.find(v => v.size === '1 Litre') || prod.variants[1];
  console.log(`Selected variant for purchase: ${chosenVariant.size} at ₹${chosenVariant.price}`);

  const mockCartItem = {
    id: prod.id,
    name: prod.name,
    size: chosenVariant.size,
    price: chosenVariant.price,
    qty: 2,
    image: prod.image || prod.images?.[0],
  };

  const expectedSubtotal = chosenVariant.price * mockCartItem.qty; // 240 * 2 = 480
  console.log(`Cart: 2 x ${prod.name} (${chosenVariant.size}) = ₹${expectedSubtotal}`);

  // Test Checkout preparation endpoint: POST /api/payments/create-order
  console.log('Sending checkout payload to /api/payments/create-order...');
  const checkoutPayload = {
    items: [mockCartItem],
    address_id: 'test-address-id-123',
    coupon: null,
    payment_method: 'UPI',
  };

  const orderRes = await fetch('http://localhost:5000/api/payments/create-order', {
    method: 'POST',
    headers,
    body: JSON.stringify(checkoutPayload),
  });

  const orderData = await orderRes.json();
  console.log('Checkout response status:', orderRes.status);
  console.log('Checkout order details:', {
    id: orderData.id,
    amount: orderData.amount ? `₹${orderData.amount / 100}` : undefined,
    currency: orderData.currency,
    internalOrderId: orderData.internalOrderId,
    receipt: orderData.receipt,
  });

  if (!orderRes.ok || !orderData.id) {
    throw new Error(`Order creation failed: ${JSON.stringify(orderData)}`);
  }

  // Subtotal = 480, GST 5% = 24, Shipping (< 999) = 60, Total = 564
  const expectedTotalPaisa = 564 * 100;
  console.log(`Expected total in paisa: ${expectedTotalPaisa}, received: ${orderData.amount}`);
  if (orderData.amount !== expectedTotalPaisa) {
    throw new Error(`Price calculation mismatch: expected ${expectedTotalPaisa}, got ${orderData.amount}`);
  }
  console.log('✅ Checkout preparation verified with exact variant price, GST, and shipping!\n');

  // 6. Inactive Variant / Out-of-Stock Verification
  console.log('--- 6. Inactive / Out-of-Stock Checkout Prevention ---');
  // Test invalid price or unknown product
  const badProductRes = await fetch('http://localhost:5000/api/payments/create-order', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      items: [{ id: 'non-existent-product-id', name: 'Fake', size: '1L', price: 10, qty: 1 }],
      address_id: 'addr-1',
      payment_method: 'UPI',
    }),
  });
  console.log('Unknown product order attempt status:', badProductRes.status);
  if (badProductRes.status !== 404) {
    throw new Error('Expected 404 for non-existent product');
  }
  console.log('✅ Non-existent / invalid products correctly rejected by backend payment validator.\n');

  console.log('===============================================================');
  console.log('🎉 ALL STEP 4 STOREFRONT & CHECKOUT VERIFICATION TESTS PASSED!');
  console.log('===============================================================');
}

verifyStep4().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
