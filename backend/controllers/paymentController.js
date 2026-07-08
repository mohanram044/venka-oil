import crypto from 'crypto';
import razorpay, { isSimulator } from '../config/razorpay.js';
import supabase from '../config/supabase.js';
import { emitNotification } from '../sockets/index.js';

export async function createRazorpayOrder(req, res) {
  try {
    const { items, address_id, coupon, payment_method } = req.body;
    const userId = req.user?.id || null;
    let userEmail = req.user?.email || null;

    if (!items || !items.length || !address_id) {
      return res.status(400).json({ message: 'Invalid order data' });
    }

    // 1. Fetch address details
    const { data: addressData, error: addressError } = await supabase
      .from('addresses')
      .select('*')
      .eq('id', address_id)
      .single();

    if (addressError || !addressData) {
      return res.status(404).json({ message: 'Address not found' });
    }

    const customer_name = addressData.name;
    const phone = addressData.mobile;
    const addressString = `${addressData.address}${addressData.landmark ? ', ' + addressData.landmark : ''}, ${addressData.city}, ${addressData.state} - ${addressData.pincode}`;
    if (!userEmail) userEmail = null;

    console.log("[ENV CHECK] SUPABASE_URL =", process.env.SUPABASE_URL);
    console.log("[Payments] incoming cartItems:", items);

    // 2. Validate Pricing from DB
    let subtotal = 0;
    const validatedItems = [];

    const productIds = items.map(item => item.id);
    console.log("[Payments] product IDs requested:", productIds);

    for (const item of items) {
      const { data: product, error } = await supabase
        .from('products')
        .select('id, name, price')
        .eq('id', item.id)
        .single();
      
      console.log(`[Payments] product fetched for ${item.id}:`, product);
      if (error) {
        console.log(`[Payments] fetch error for ${item.id}:`, error);
      }
      
      if (!product) {
        return res.status(404).json({ message: `Product ${item.id} not found` });
      }

      // Use product price from DB
      let price = product.price != null ? product.price : item.price;
      
      subtotal += price * item.qty;
      validatedItems.push({
        ...item,
        price,
        name: product.name
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

    // 4. Create pending order
    const { data: order, error: orderError } = await supabase
      .from('new_orders')
      .insert({
        user_id: userId,
        customer_name,
        phone,
        email: userEmail,
        address: addressString,
        items: validatedItems,
        subtotal,
        gst,
        shipping,
        discount,
        total,
        coupon: coupon || null,
        payment_method: payment_method || 'credit_card',
        status: 'pending', // Pending payment
      })
      .select()
      .single();

    if (orderError || !order) {
      console.error('[Payment] DB Order Error:', orderError);
      return res.status(500).json({ message: 'Failed to create internal order' });
    }

    // 5. Create Razorpay order
    const rpOrder = await razorpay.orders.create({
      amount: Math.round(order.total * 100), // Paise
      currency: 'INR',
      receipt: `receipt_${order.id.slice(0, 8)}`,
      notes: { orderId: order.id, customerName: order.customer_name },
    });

    // 6. Update order with razorpay_order_id
    await supabase
      .from('new_orders')
      .update({ razorpay_order_id: rpOrder.id })
      .eq('id', order.id);

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
    const { data: order, error } = await supabase
      .from('new_orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (error || !order) {
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
