-- Migration: Product Management Foundation and Variants Support
-- Preserves existing products, IDs, and payment flows while adding variant management and bilingual fields

-- 1. Extend products table with required variant, category, and bilingual fields
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS tamil_name text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS variants jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}'::text[];
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS category text;

-- 2. Create normalized product_variants table for structured variant queries
CREATE TABLE IF NOT EXISTS public.product_variants (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
  size text NOT NULL,
  price numeric NOT NULL DEFAULT 0,
  stock integer NOT NULL DEFAULT 0,
  sku text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(product_id, size)
);

-- 3. Enable Row Level Security on product_variants
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies for product_variants
DROP POLICY IF EXISTS "Public can view product variants" ON public.product_variants;
CREATE POLICY "Public can view product variants"
  ON public.product_variants FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins can manage product variants" ON public.product_variants;
CREATE POLICY "Admins can manage product variants"
  ON public.product_variants FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- 5. Helper trigger to automatically sync JSONB variants on product updates if needed
CREATE OR REPLACE FUNCTION public.sync_product_variants()
RETURNS trigger AS $$
BEGIN
  -- If variants JSONB array was provided, sync rows to product_variants table
  IF NEW.variants IS NOT NULL AND jsonb_typeof(NEW.variants) = 'array' THEN
    DELETE FROM public.product_variants WHERE product_id = NEW.id;
    INSERT INTO public.product_variants (product_id, size, price, stock, sku)
    SELECT
      NEW.id,
      elem->>'size',
      COALESCE((elem->>'price')::numeric, 0),
      COALESCE((elem->>'stock')::int, 0),
      COALESCE(elem->>'sku', NEW.sku)
    FROM jsonb_array_elements(NEW.variants) AS elem
    WHERE elem->>'size' IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_sync_product_variants ON public.products;
CREATE TRIGGER trigger_sync_product_variants
  AFTER INSERT OR UPDATE OF variants ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_product_variants();
