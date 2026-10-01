import crypto from 'crypto';
import razorpay, { isSimulator } from '../config/razorpay.js';
import supabase, { isSupabaseConfigured } from '../config/supabase.js';
import { emitNotification } from '../sockets/index.js';
import { SEED_PRODUCTS } from '../scripts/seed.js';

export const ordersCache = new Map();

export async function createRazorpayOrder(req, res) {
  try {
    const { items, address_id, coupon, payment_method } = req.body;
    const userId = req.user?.id || null;
    let userEmail = req.user?.email || null;

    if (!items || !items.length || !address_id) {
      return res.status(400).json({ message: 'Invalid order data' });
    }

    // 1. Fetch address details
    let customer_name = 'Customer';
    let phone = '9876543210';
    let addressString = '123 Main St, Salem, Tamil Nadu - 636001';

    try {
      const { data: addressData, error: addressError } = await supabase
        .from('addresses')
        .select('*')
        .eq('id', address_id)
        .single();

      if (addressData) {
        customer_name = addressData.name || customer_name;
        phone = addressData.mobile || phone;
        addressString = `${addressData.address}${addressData.landmark ? ', ' + addressData.landmark : ''}, ${addressData.city}, ${addressData.state} - ${addressData.pincode}`;
      } else if (addressError && !addressError.message?.includes('fetch failed')) {
        return res.status(404).json({ message: 'Address not found' });
      }
    } catch (e) {
      console.warn('[Payments] Address lookup network notice (using fallback):', e.message);
    }
    if (!userEmail) userEmail = null;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Cart is empty. Please add items to checkout.' });
    }

    console.log("[ENV CHECK] SUPABASE_URL =", process.env.SUPABASE_URL);
    console.log("[Payments] incoming cartItems:", items);

    // 2. Validate Pricing from DB
    let subtotal = 0;
    const validatedItems = [];

    const productIds = items.map(item => item.id);
    console.log("[Payments] product IDs requested:", productIds);

    for (const item of items) {
      let product = null;
      if (isSupabaseConfigured) {
        try {
          const { data, error } = await supabase
            .from('products')
            .select('id, name, price, variants')
            .eq('id', item.id)
            .single();
          if (!error && data) {
            product = data;
          }
        } catch (e) {
          console.warn(`[Payments] Supabase lookup error for ${item.id}:`, e.message);
        }
      }

      if (!product) {
        const fallback = SEED_PRODUCTS.find(p => p.id === item.id || p.slug === item.id);
        if (fallback) {
          product = {
            id: fallback.id,
            name: fallback.name,
            price: fallback.price,
            variants: fallback.variants,
          };
        }
      }
      
      if (!product) {
        return res.status(404).json({ message: `Product ${item.id} not found` });
      }

      // Check variant price if size is specified, otherwise fallback to product base price or item price
      let price = Number(item.price) || 0;
      if (item.size && Array.isArray(product.variants) && product.variants.length > 0) {
        const matchedVariant = product.variants.find(
          (v) => String(v.size).trim().toLowerCase() === String(item.size).trim().toLowerCase()
        );
        if (matchedVariant && matchedVariant.price != null) {
          price = Number(matchedVariant.price);
        } else if (product.price != null && Number(product.price) > 0) {
          price = Number(product.price);
        }
      } else if (product.price != null && Number(product.price) > 0) {
        price = Number(product.price);
      }
      
      // Check stock and prevent overselling
      let availableStock = 0;
      if (item.size && Array.isArray(product.variants) && product.variants.length > 0) {
        const v = product.variants.find(
          (varItem) => String(varItem.size).trim().toLowerCase() === String(item.size).trim().toLowerCase()
        );
        if (v && v.stock !== undefined && v.stock !== null) {
          availableStock = Number(v.stock);
        } else {
          availableStock = Number(product.stock || 0);
        }
      } else {
        availableStock = Number(product.stock || 0);
      }

      if (availableStock <= 0) {
        return res.status(400).json({
          message: `${product.name} (${item.size || 'Standard'}) is out of stock`,
        });
      }

      if (item.qty > availableStock) {
        return res.status(400).json({
          message: `Requested quantity (${item.qty}) exceeds available stock (${availableStock}) for ${product.name} (${item.size || 'Standard'})`,
        });
      }

      subtotal += price * item.qty;
      validatedItems.push({
        ...item,
        price,
        name: product.name,
      });
    }

    // 3. Calculate Totals
    let discountPct = 0;
    if (coupon && coupon.trim().toUpperCase() === "SVOM10") {
      discountPct = 10;
    }
    const discount = Math.round((subtotal * discountPct) / 100);
    const taxable = subtotal - discount;
    const gst = Math.round(taxable * 0.05);
    const shipping = taxable === 0 ? 0 : taxable > 999 ? 0 : 60;
    const total = taxable + gst + shipping;

    const subtotalNum = Number(subtotal) || 0;
    const gstNum = Number(gst) || 0;
    const shippingNum = Number(shipping) || 0;
    const discountNum = Number(discount) || 0;
    const totalNum = Number(total) || Math.max(0, subtotalNum + gstNum + shippingNum - discountNum);

    // 4. Create pending order
    const generatedOrderNumber = `ORD-${Date.now()}`;
    const insertPayload = {
      user_id: userId,
      order_number: generatedOrderNumber,
      address_id: address_id || null,
      subtotal: subtotalNum,
      gst_total: gstNum,
      shipping_total: shippingNum,
      discount_total: discountNum,
      grand_total: totalNum,
      status: 'pending',
      coupon_code: coupon || null,
      delivery_notes: null,
      expected_delivery_date: null,
    };

    let order = null;
    try {
      const { data, error: orderError } = await supabase
        .from('new_orders')
        .insert(insertPayload)
        .select()
        .single();
      if (data) {
        order = data;
      } else if (orderError) {
        console.warn('[Payment] DB Order notice:', orderError.message || orderError);
      }
    } catch (e) {
      console.warn('[Payment] Supabase order network notice:', e.message);
    }

    if (!order) {
      order = {
        id: `ord_${Date.now()}`,
        ...insertPayload
      };
    }

    // 4.5. Insert order items
    const orderItemRows = validatedItems.map((item) => ({
      order_id: order.id,
      product_name: item.name,
      quantity: item.qty,
      price: Number(item.price) || 0,
      total: (Number(item.price) || 0) * (Number(item.qty) || 0),
      product_id: item.id || null,
      size: item.size || null,
    }));

    try {
      const { error: itemsError } = await supabase
        .from('order_items')
        .insert(orderItemRows);
      if (itemsError) {
        console.warn('[Payment] DB Order Items notice:', itemsError.message || itemsError);
      }
    } catch (e) {
      console.warn('[Payment] Order items network notice:', e.message);
    }

    // 5. Create Razorpay order
    let rpOrder;
    try {
      rpOrder = await razorpay.orders.create({
        amount: Math.round(totalNum * 100), // Paise
        currency: 'INR',
        receipt: `receipt_${order.id.slice(0, 8)}`,
        notes: { orderId: order.id, customerName: customer_name },
      });
    } catch (rpErr) {
      console.warn('[Payment] Razorpay order notice (falling back to simulator):', rpErr.message || rpErr);
      rpOrder = {
        id: `sim_${Date.now()}`,
        amount: Math.round(totalNum * 100),
        currency: 'INR',
        receipt: `receipt_${order.id.slice(0, 8)}`,
        notes: { orderId: order.id, customerName: customer_name },
      };
    }

    // 6. Update order with razorpay_order_id
    try {
      await supabase
        .from('new_orders')
        .update({ razorpay_order_id: rpOrder.id })
        .eq('id', order.id);
    } catch (e) {
      console.warn('[Payment] Update order razorpay_order_id notice:', e.message);
    }

    ordersCache.set(order.id, {
      ...order,
      items: validatedItems,
      customer_name,
    });

    res.status(200).json({
      ...rpOrder,
      internalOrderId: order.id,
      amount: rpOrder.amount, // in paise
    });
  } catch (error) {
    console.error('[Payment] createRazorpayOrder error:', error);
    res.status(500).json({ message: 'Error creating payment order' });
  }
}

export async function verifyPayment(req, res) {
  const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  try {
    let order = null;
    if (isSupabaseConfigured) {
      try {
        const { data } = await supabase
          .from('new_orders')
          .select('*')
          .eq('id', orderId)
          .single();
        if (data) order = data;
      } catch (err) {
        console.warn('[Payment] Fetch new_orders notice:', err.message);
      }
    }

    if (!order && ordersCache.has(orderId)) {
      order = ordersCache.get(orderId);
    }

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.status === 'confirmed' || order.status === 'paid') {
      return res.status(200).json({ message: 'Payment already verified', orderId: order.id });
    }

    // Verify HMAC signature
    let isValid = false;
    if (isSimulator) {
      isValid = true;
      console.log('[Payment Simulator] Mock payment verified for order', orderId);
    } else {
      const body = `${razorpay_order_id}|${razorpay_payment_id}`;
      const expectedSig = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(body)
        .digest('hex');
      isValid = expectedSig === razorpay_signature;
    }

    if (!isValid) {
      // Log failed payment
      await supabase.from('payments').insert({
        user_id: order.user_id,
        order_id: order.id,
        customer_name: order.customer_name,
        payment_method: order.payment_method,
        amount: order.total,
        status: 'failed',
        razorpay_order_id,
        razorpay_payment_id,
      });

      await supabase
        .from('new_orders')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', orderId);

      return res.status(400).json({ message: 'Payment verification failed' });
    }

    // Update order status to confirmed
    await supabase
      .from('new_orders')
      .update({ 
        status: 'confirmed', 
        razorpay_payment_id, 
        razorpay_signature,
        payment_status: 'paid',
        updated_at: new Date().toISOString() 
      })
      .eq('id', orderId);

    // Deduct stock for order items (both database and in-memory fallback)
    if (isSupabaseConfigured) {
      try {
        await supabase.rpc('deduct_order_stock', { p_order_id: orderId });
      } catch (err) {
        console.warn('[Payment] Supabase deduct_order_stock notice:', err.message);
      }
    }

    try {
      const { data: dbItems } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', orderId);

      const itemsToDeduct = (dbItems && dbItems.length > 0)
        ? dbItems
        : (order.items || ordersCache.get(orderId)?.items || []);
      for (const it of itemsToDeduct) {
        const prod = SEED_PRODUCTS.find(p => p.id === it.product_id || p.id === it.id);
        if (prod) {
          const qty = Number(it.quantity) || Number(it.qty) || 1;
          if (it.size && Array.isArray(prod.variants)) {
            const variant = prod.variants.find(
              v => String(v.size).trim().toLowerCase() === String(it.size).trim().toLowerCase()
            );
            if (variant) {
              variant.stock = Math.max(0, (Number(variant.stock) || 0) - qty);
            }
          }
          prod.stock = Math.max(0, (Number(prod.stock) || 0) - qty);
        }
      }
    } catch (e) {
      console.warn('[Payment] In-memory stock deduction notice:', e.message);
    }

    // Log successful payment
    const { data: paymentLog } = await supabase
      .from('payments')
      .insert({
        user_id: order.user_id,
        order_id: order.id,
        customer_name: order.customer_name,
        payment_method: order.payment_method,
        amount: order.total,
        status: 'completed',
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        location: order.address?.split(',').slice(-2).join(',').trim() || '',
      })
      .select()
      .single();

    // Admin notification
    await supabase.from('notifications').insert({
      message: `Payment of ₹${order.total} received from ${order.customer_name} for order #${orderId.slice(0, 8).toUpperCase()}`,
      type: 'payment',
    });

    emitNotification('admin', 'payment', {
      paymentId: paymentLog?.id,
      orderId,
      customerName: order.customer_name,
      amount: order.total,
    });

    if (order.user_id) {
      emitNotification(order.user_id, 'payment_status', {
        orderId,
        status: 'completed',
        message: 'Your payment was processed successfully!',
      });
    }

    res.status(200).json({ message: 'Payment verified successfully', orderId: order.id });
  } catch (error) {
    console.error('[Payment] verifyPayment error:', error);
    res.status(500).json({ message: 'Error verifying payment' });
  }
}

export async function razorpayWebhook(req, res) {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!secret || isSimulator) {
      return res.status(200).send('Simulator / Webhook bypassed');
    }

    const isValid = razorpay.validateWebhookSignature(req.rawBody, signature, secret);
    if (!isValid) {
      return res.status(400).send('Invalid signature');
    }

    const payload = JSON.parse(req.rawBody.toString('utf8'));
    const event = payload.event;
    
    if (event === 'payment.captured' || event === 'payment.authorized') {
      const paymentEntity = payload.payload.payment.entity;
      const rpOrderId = paymentEntity.order_id;
      const rpPaymentId = paymentEntity.id;

      const { data: order } = await supabase
        .from('new_orders')
        .select('*')
        .eq('razorpay_order_id', rpOrderId)
        .single();

      if (order && order.status === 'pending') {
        // Idempotently confirm order
        await supabase
          .from('new_orders')
          .update({ 
            status: 'confirmed', 
            razorpay_payment_id: rpPaymentId,
            payment_status: 'paid',
            updated_at: new Date().toISOString()
          })
          .eq('id', order.id);

        await supabase
          .from('payments')
          .insert({
            user_id: order.user_id,
            order_id: order.id,
            customer_name: order.customer_name,
            payment_method: order.payment_method,
            amount: order.total,
            status: 'completed',
            razorpay_order_id: rpOrderId,
            razorpay_payment_id: rpPaymentId,
          });
      }
    } else if (event === 'payment.failed') {
      const paymentEntity = payload.payload.payment.entity;
      const rpOrderId = paymentEntity.order_id;

      const { data: order } = await supabase
        .from('new_orders')
        .select('*')
        .eq('razorpay_order_id', rpOrderId)
        .single();

      if (order && order.status === 'pending') {
        await supabase
          .from('new_orders')
          .update({ 
            status: 'failed',
            updated_at: new Date().toISOString()
          })
          .eq('id', order.id);
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('[Payment] Webhook Error:', error);
    res.status(500).send('Webhook Error');
  }
}

export async function getPaymentHistory(req, res) {
  try {
    let query = supabase.from('payments').select('*').order('created_at', { ascending: false });
    const { data, error } = await query;
    if (error) throw error;
    res.status(200).json(data || []);
  } catch (error) {
    console.error('[Payment] getPaymentHistory error:', error);
    res.status(500).json({ message: 'Error fetching payment history' });
  }
}

export async function testCodOrderFlow(req, res) {
  try {
    const { items, address_id, coupon } = req.body;
    if (!items || !items.length) {
      return res.status(400).json({ message: 'Cart items required' });
    }

    let subtotal = 0;
    const validatedItems = [];

    for (const item of items) {
      let product = null;
      if (isSupabaseConfigured) {
        try {
          const { data } = await supabase
            .from('products')
            .select('id, name, price, variants, stock')
            .eq('id', item.id)
            .single();
          if (data) product = data;
        } catch {}
      }

      if (!product) {
        const fallback = SEED_PRODUCTS.find(p => p.id === item.id || p.slug === item.id);
        if (fallback) product = fallback;
      }

      if (!product) {
        return res.status(404).json({ message: `Product ${item.id} not found` });
      }

      let price = Number(item.price) || 0;
      let matchedVariant = null;
      let availableStock = 0;

      if (item.size && Array.isArray(product.variants) && product.variants.length > 0) {
        matchedVariant = product.variants.find(
          v => String(v.size).trim().toLowerCase() === String(item.size).trim().toLowerCase()
        );
        if (matchedVariant) {
          price = Number(matchedVariant.price) || price;
          availableStock = Number(matchedVariant.stock) || 0;
        } else {
          availableStock = Number(product.stock) || 0;
        }
      } else {
        availableStock = Number(product.stock) || 0;
      }

      if (availableStock <= 0) {
        return res.status(400).json({
          message: `${product.name} (${item.size || 'Standard'}) is out of stock`,
        });
      }

      if (item.qty > availableStock) {
        return res.status(400).json({
          message: `Requested quantity (${item.qty}) exceeds available stock (${availableStock}) for ${product.name} (${item.size || 'Standard'})`,
        });
      }

      subtotal += price * item.qty;
      validatedItems.push({ ...item, price, name: product.name });
    }

    const discountPct = coupon && coupon.trim().toUpperCase() === "SVOM10" ? 10 : 0;
    const discount = Math.round((subtotal * discountPct) / 100);
    const taxable = subtotal - discount;
    const gst = Math.round(taxable * 0.05);
    const shipping = taxable === 0 ? 0 : taxable > 999 ? 0 : 60;
    const total = taxable + gst + shipping;

    const testOrderId = `test_cod_${Date.now()}`;

    // Deduct stock in memory / SEED_PRODUCTS
    for (const it of validatedItems) {
      const prod = SEED_PRODUCTS.find(p => p.id === it.id);
      if (prod) {
        if (it.size && Array.isArray(prod.variants)) {
          const v = prod.variants.find(varItem => String(varItem.size).trim().toLowerCase() === String(it.size).trim().toLowerCase());
          if (v) {
            v.stock = Math.max(0, (Number(v.stock) || 0) - it.qty);
          }
        }
        prod.stock = Math.max(0, (Number(prod.stock) || 0) - it.qty);
      }
    }

    ordersCache.set(testOrderId, {
      id: testOrderId,
      order_number: `ORD-COD-${Date.now()}`,
      status: 'pending',
      items: validatedItems,
      total,
      subtotal,
      gst,
      shipping,
    });

    res.status(200).json({
      success: true,
      message: 'Simulated COD order placed successfully and stock deducted',
      orderId: testOrderId,
      total,
      subtotal,
      gst,
      shipping,
      items: validatedItems,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

