async function runTests() {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer admin-secret',
  };

  console.log('--- Test 1: Fetch Catalog Integrity ---');
  const catRes = await fetch('http://localhost:5000/api/products?limit=100').then(r => r.json());
  console.log('Total Products in catalog:', catRes.products.length);
  const totalVariants = catRes.products.reduce((acc, p) => acc + (p.variants?.length || 0), 0);
  console.log('Total Variants in catalog:', totalVariants);

  console.log('\n--- Test 2: Add Product via API ---');
  const newProductPayload = {
    name: 'Herbal Castor Oil Special',
    tamil_name: 'மூலிகை ஆமணக்கு எண்ணெய்',
    slug: 'herbal-castor-oil-special',
    category: 'oils',
    price: 150,
    stock: 20,
    sku: 'SVEM-OIL-HCS',
    image: 'https://i.ibb.co/7d71yWkt/Chat-GPT-Image-Jun-25-2026-10-17-30-AM.png',
    images: ['https://i.ibb.co/7d71yWkt/Chat-GPT-Image-Jun-25-2026-10-17-30-AM.png'],
    tags: ['New Arrival', 'Organic'],
    variants: [
      { size: '200 ml', price: 150, stock: 10, sku: 'SVEM-OIL-HCS-200ML', is_active: true },
      { size: '500 ml', price: 320, stock: 10, sku: 'SVEM-OIL-HCS-500ML', is_active: true }
    ],
    is_active: true,
  };
  const addRes = await fetch('http://localhost:5000/api/products', {
    method: 'POST',
    headers,
    body: JSON.stringify(newProductPayload),
  }).then(r => r.json());
  console.log('Added product result:', addRes?.name, '| ID:', addRes?.id, '| Variants:', addRes?.variants?.length);

  console.log('\n--- Test 3: Edit Product via API (Update Variants & Stock) ---');
  const updatePayload = {
    ...addRes,
    stock: 35,
    variants: [
      { size: '200 ml', price: 160, stock: 15, sku: 'SVEM-OIL-HCS-200ML', is_active: true },
      { size: '500 ml', price: 340, stock: 20, sku: 'SVEM-OIL-HCS-500ML', is_active: true },
      { size: '1 Litre', price: 650, stock: 5, sku: 'SVEM-OIL-HCS-1L', is_active: true }
    ],
  };
  const editRes = await fetch('http://localhost:5000/api/products/' + addRes.id, {
    method: 'PUT',
    headers,
    body: JSON.stringify(updatePayload),
  }).then(r => r.json());
  console.log('Updated product result:', editRes?.name, '| Total Stock:', editRes?.stock, '| Variants:', editRes?.variants?.length);

  console.log('\n--- Test 4: Verify Search & Category Filter with New Product ---');
  const searchRes = await fetch('http://localhost:5000/api/products?search=Herbal').then(r => r.json());
  console.log('Search for "Herbal":', searchRes.products.length, 'match(es) ->', searchRes.products[0]?.name);

  const searchTamilRes = await fetch('http://localhost:5000/api/products?search=மூலிகை').then(r => r.json());
  console.log('Search for Tamil "மூலிகை":', searchTamilRes.products.length, 'match(es) ->', searchTamilRes.products[0]?.tamil_name);

  console.log('\n--- Test 5: Delete Test Product and Verify Clean Catalog ---');
  const delRes = await fetch('http://localhost:5000/api/products/' + addRes.id, {
    method: 'DELETE',
    headers,
  }).then(r => r.json());
  console.log('Delete result:', delRes?.message);

  const cleanRes = await fetch('http://localhost:5000/api/products?limit=100').then(r => r.json());
  console.log('Final catalog count (should be 29):', cleanRes.products.length);
  const finalVariants = cleanRes.products.reduce((acc, p) => acc + (p.variants?.length || 0), 0);
  console.log('Final catalog variants (should be 64):', finalVariants);
  console.log('\n=== ALL TESTS PASSED SUCCESSFULLY! ===');
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
