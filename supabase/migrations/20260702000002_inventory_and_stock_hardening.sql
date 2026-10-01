-- Migration: Inventory & Stock Management Hardening (Step 5)
-- Ensures atomic variant-level stock validation, deduction, and restoration on cancellation.

-- 1. Ensure order_items table has size column for pack size tracking
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS size text;

-- 2. Update admin_orders_view to include item size
CREATE OR REPLACE VIEW public.admin_orders_view WITH (security_invoker = true) AS
SELECT 
  o.id,
  o.order_number,
  o.created_at,
  o.subtotal,
  o.gst_total,
  o.shipping_total,
  o.discount_total,
  o.grand_total,
  o.status AS order_status,
  o.expected_delivery_date,
  o.delivery_notes,
  p.full_name AS customer_name,
  p.mobile AS customer_mobile,
  a.address AS shipping_address,
  a.city AS shipping_city,
  a.state AS shipping_state,
  a.pincode AS shipping_pincode,
  pay.method AS payment_method,
  pay.status AS payment_status,
  pay.razorpay_order_id,
  dp.id AS delivery_partner_id,
  dp.name AS delivery_partner_name,
  (
    SELECT json_agg(json_build_object(
      'id', oi.id,
      'product_name', oi.product_name,
      'quantity', oi.quantity,
      'price', oi.price,
      'total', oi.total,
      'size', oi.size
    ))
    FROM public.order_items oi
    WHERE oi.order_id = o.id
  ) AS items,
  (
    SELECT json_agg(json_build_object(
      'id', dl.id,
      'status', dl.status,
      'note', dl.note,
      'updated_by', dl.updated_by,
      'created_at', dl.created_at
    ) ORDER BY dl.created_at DESC)
    FROM public.delivery_logs dl
    WHERE dl.order_id = o.id
  ) AS logs
FROM public.new_orders o
LEFT JOIN public.profiles p ON o.user_id = p.id
LEFT JOIN public.addresses a ON o.address_id = a.id
LEFT JOIN public.payments pay ON o.id = pay.order_id
LEFT JOIN public.delivery_partners dp ON o.delivery_partner_id = dp.id
WHERE EXISTS (
  SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
);

-- 3. Dedicated RPC to atomically deduct stock for an order
CREATE OR REPLACE FUNCTION public.deduct_order_stock(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item record;
  v_variant_stock int;
  v_prod_stock int;
BEGIN
  FOR v_item IN 
    SELECT oi.product_id, oi.product_name, oi.quantity, oi.size
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
  LOOP
    IF v_item.size IS NOT NULL THEN
      -- Check & lock variant stock
      SELECT stock INTO v_variant_stock
      FROM public.product_variants
      WHERE product_id = v_item.product_id AND size = v_item.size
      FOR UPDATE;

      IF v_variant_stock IS NOT NULL THEN
        IF v_variant_stock < v_item.quantity THEN
          RAISE EXCEPTION 'Insufficient stock for % (%) - only % available', v_item.product_name, v_item.size, v_variant_stock;
        END IF;

        UPDATE public.product_variants
        SET stock = stock - v_item.quantity,
            updated_at = timezone('utc'::text, now())
        WHERE product_id = v_item.product_id AND size = v_item.size;
      END IF;

      -- Sync JSONB variants on products table
      UPDATE public.products
      SET variants = (
        SELECT jsonb_agg(
          CASE 
            WHEN elem->>'size' = v_item.size
            THEN jsonb_set(elem, '{stock}', to_jsonb(GREATEST(0, COALESCE((elem->>'stock')::int, 0) - v_item.quantity)))
            ELSE elem
          END
        )
        FROM jsonb_array_elements(COALESCE(variants, '[]'::jsonb)) AS elem
      )
      WHERE id = v_item.product_id;
    END IF;

    -- Update parent product overall stock
    UPDATE public.products
    SET stock = GREATEST(0, stock - v_item.quantity)
    WHERE id = v_item.product_id;
  END LOOP;
END;
$$;

-- 4. Dedicated RPC to safely restore stock when an order is cancelled
CREATE OR REPLACE FUNCTION public.restore_order_stock(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item record;
BEGIN
  FOR v_item IN 
    SELECT oi.product_id, oi.quantity, oi.size
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
  LOOP
    IF v_item.size IS NOT NULL THEN
      -- Restore variant stock
      UPDATE public.product_variants
      SET stock = stock + v_item.quantity,
          updated_at = timezone('utc'::text, now())
      WHERE product_id = v_item.product_id AND size = v_item.size;

      -- Sync JSONB variants on products
      UPDATE public.products
      SET variants = (
        SELECT jsonb_agg(
          CASE 
            WHEN elem->>'size' = v_item.size
            THEN jsonb_set(elem, '{stock}', to_jsonb(COALESCE((elem->>'stock')::int, 0) + v_item.quantity))
            ELSE elem
          END
        )
        FROM jsonb_array_elements(COALESCE(variants, '[]'::jsonb)) AS elem
      )
      WHERE id = v_item.product_id;
    END IF;

    -- Restore parent product stock
    UPDATE public.products
    SET stock = stock + v_item.quantity
    WHERE id = v_item.product_id;
  END LOOP;
END;
$$;

-- 5. Updated commit_order_transaction RPC with variant-level stock validation and deduction
CREATE OR REPLACE FUNCTION public.commit_order_transaction(
  p_user_id uuid,
  p_order_details json,
  p_razorpay_order_id text DEFAULT NULL,
  p_razorpay_payment_id text DEFAULT NULL,
  p_razorpay_signature text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_id uuid;
  v_item json;
  v_variant_stock int;
  v_prod_stock int;
  v_payment_status payment_status;
BEGIN
  v_payment_status := CASE WHEN p_razorpay_payment_id IS NOT NULL THEN 'completed'::payment_status ELSE 'pending'::payment_status END;

  -- 1. Insert into new_orders
  INSERT INTO public.new_orders (
    user_id,
    address_id,
    subtotal,
    gst_total,
    shipping_total,
    discount_total,
    grand_total,
    status,
    coupon_code,
    razorpay_order_id
  ) VALUES (
    p_user_id,
    (p_order_details->>'address_id')::uuid,
    (p_order_details->>'subtotal')::numeric,
    (p_order_details->>'gst')::numeric,
    (p_order_details->>'shipping')::numeric,
    (p_order_details->>'discount')::numeric,
    (p_order_details->>'total')::numeric,
    'confirmed',
    p_order_details->>'coupon',
    p_razorpay_order_id
  ) RETURNING id INTO v_order_id;

  -- 2. Validate stock, deduct stock, and insert order items
  FOR v_item IN SELECT * FROM json_array_elements(p_order_details->'items')
  LOOP
    -- Variant-level check if size is specified
    IF v_item->>'size' IS NOT NULL THEN
      SELECT stock INTO v_variant_stock 
      FROM public.product_variants 
      WHERE product_id = (v_item->>'id')::uuid AND size = (v_item->>'size')
      FOR UPDATE;

      IF v_variant_stock IS NOT NULL THEN
        IF v_variant_stock <= 0 THEN
          RAISE EXCEPTION 'Variant % (%) is out of stock', v_item->>'name', v_item->>'size';
        END IF;
        IF v_variant_stock < (v_item->>'qty')::int THEN
          RAISE EXCEPTION 'Insufficient stock for % (%) - % requested, only % available', 
            v_item->>'name', v_item->>'size', (v_item->>'qty')::int, v_variant_stock;
        END IF;

        -- Deduct variant stock
        UPDATE public.product_variants 
        SET stock = stock - (v_item->>'qty')::int,
            updated_at = timezone('utc'::text, now())
        WHERE product_id = (v_item->>'id')::uuid AND size = (v_item->>'size');

        -- Sync JSONB variants array on products table
        UPDATE public.products
        SET variants = (
          SELECT jsonb_agg(
            CASE 
              WHEN elem->>'size' = (v_item->>'size')
              THEN jsonb_set(elem, '{stock}', to_jsonb(GREATEST(0, COALESCE((elem->>'stock')::int, 0) - (v_item->>'qty')::int)))
              ELSE elem
            END
          )
          FROM jsonb_array_elements(COALESCE(variants, '[]'::jsonb)) AS elem
        )
        WHERE id = (v_item->>'id')::uuid;
      END IF;
    END IF;

    -- Parent product stock check and deduction
    SELECT stock INTO v_prod_stock 
    FROM public.products 
    WHERE id = (v_item->>'id')::uuid 
    FOR UPDATE;

    IF v_variant_stock IS NULL AND v_prod_stock < (v_item->>'qty')::int THEN
      RAISE EXCEPTION 'Insufficient stock for product %', v_item->>'name';
    END IF;

    UPDATE public.products 
    SET stock = GREATEST(0, stock - (v_item->>'qty')::int) 
    WHERE id = (v_item->>'id')::uuid;

    -- Insert order item with size
    INSERT INTO public.order_items (
      order_id,
      product_id,
      product_name,
      quantity,
      price,
      gst_amount,
      total,
      size
    ) VALUES (
      v_order_id,
      (v_item->>'id')::uuid,
      v_item->>'name',
      (v_item->>'qty')::int,
      (v_item->>'price')::numeric,
      ((v_item->>'price')::numeric * (v_item->>'qty')::int) * 0.05,
      (v_item->>'price')::numeric * (v_item->>'qty')::int,
      v_item->>'size'
    );
  END LOOP;

  -- 3. Insert payment record
  INSERT INTO public.payments (
    order_id,
    user_id,
    amount,
    method,
    status,
    razorpay_payment_id,
    razorpay_order_id,
    razorpay_signature
  ) VALUES (
    v_order_id,
    p_user_id,
    (p_order_details->>'total')::numeric,
    (p_order_details->>'payment_method')::payment_method,
    v_payment_status,
    p_razorpay_payment_id,
    p_razorpay_order_id,
    p_razorpay_signature
  );

  RETURN v_order_id;
END;
$$;

-- 6. Updated update_delivery_status RPC with automatic stock restoration on cancellation
CREATE OR REPLACE FUNCTION public.update_delivery_status(
  p_order_id uuid,
  p_status text,
  p_note text DEFAULT NULL,
  p_partner_id uuid DEFAULT NULL,
  p_expected_date timestamp with time zone DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin_name text;
  v_old_status text;
  v_already_restored boolean := false;
BEGIN
  -- Security check: only admins
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Get admin name (Optional, fallback to System)
  SELECT full_name INTO v_admin_name FROM public.profiles WHERE id = auth.uid();
  IF v_admin_name IS NULL THEN v_admin_name := 'Admin System'; END IF;

  -- Get current order status
  SELECT status INTO v_old_status FROM public.new_orders WHERE id = p_order_id FOR UPDATE;

  -- Restore stock if transitioning to cancelled or returned for the first time
  IF v_old_status IS NOT NULL 
     AND v_old_status NOT IN ('cancelled', 'Cancelled', 'Returned')
     AND p_status IN ('cancelled', 'Cancelled', 'Returned') THEN
    
    PERFORM public.restore_order_stock(p_order_id);
    v_already_restored := true;
  END IF;

  -- Update order (preserves payment_status untouched)
  UPDATE public.new_orders 
  SET 
    status = p_status,
    delivery_partner_id = COALESCE(p_partner_id, delivery_partner_id),
    expected_delivery_date = COALESCE(p_expected_date, expected_delivery_date),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_order_id;

  -- Insert Log
  INSERT INTO public.delivery_logs (order_id, status, note, updated_by)
  VALUES (
    p_order_id, 
    p_status, 
    CASE 
      WHEN v_already_restored THEN COALESCE(p_note, 'Order cancelled - stock restored')
      ELSE p_note 
    END, 
    v_admin_name
  );

END;
$$;
