import { z } from 'zod';
import { validate } from './authValidator.js';

/** Schema for a single product variant (size, price, stock, sku, is_active) */
const variantSchema = z.object({
  id: z.string().optional(),
  size: z.string().min(1, 'Variant size is required'),
  price: z.coerce.number().min(0, 'Variant price must be non-negative'),
  stock: z.coerce.number().int().min(0).optional().default(0),
  sku: z.string().optional(),
  is_active: z.boolean().optional().default(true),
});

/**
 * createProductSchema — Validates the body of POST /api/products
 */
export const createProductSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  tamil_name: z.string().optional(),
  slug: z.string().optional(),
  category: z.enum(['oils', 'dryfruits', 'palm-products', 'honey', 'millets']),
  description: z.string().optional().default(''),
  price: z.coerce.number().min(0).optional().default(0),
  stock: z.coerce.number().int().min(0).optional().default(0),
  sku: z.string().optional(),
  image: z.string().optional(),
  images: z.array(z.string()).optional().default([]),
  variants: z.array(variantSchema).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
  is_active: z.boolean().optional().default(true),
  enabled: z.boolean().optional().default(true),
  rating: z.number().min(1).max(5).optional().default(5),
});

/**
 * updateProductSchema — Validates the body of PUT /api/products/:id
 */
export const updateProductSchema = createProductSchema.partial();

export { validate };
