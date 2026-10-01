import supabase, { isSupabaseConfigured } from '../config/supabase.js';
import { uploadToCloudinary } from '../middleware/upload.js';
import { SEED_PRODUCTS } from '../scripts/seed.js';

/**
 * @swagger
 * /api/products:
 *   get:
 *     summary: Get all products with filtering, sorting, search and pagination
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [featured, price-asc, price-desc, name, newest]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of products
 */
export async function getProducts(req, res) {
  const { category, search, sort, tag, page = 1, limit = 20 } = req.query;

  try {
    let allProducts = null;
    if (isSupabaseConfigured) {
      let query = supabase.from('products').select('*');

      if (category && category !== 'all') {
        query = query.eq('category', category);
      }

      if (tag) {
        query = query.contains('tags', [tag]);
      }

      if (search) {
        query = query.or(
          `name.ilike.%${search}%,description.ilike.%${search}%,tamil_name.ilike.%${search}%,sku.ilike.%${search}%,slug.ilike.%${search}%`
        );
      }

      const { data, error } = await query;
      if (error) {
        console.warn('[Product] Supabase query warning:', error.message);
      } else {
        allProducts = data;
      }
    }

    // Filter by active status (supporting both is_active and enabled columns)
    let products = (allProducts || []).filter(
      (p) => p.is_active !== false && p.enabled !== false
    );

    // Fallback to SEED_PRODUCTS if database returned no products
    if (products.length === 0) {
      let filtered = [...SEED_PRODUCTS].filter(
        (p) => p.is_active !== false && p.enabled !== false
      );
      if (category && category !== 'all') {
        filtered = filtered.filter((p) => p.category === category);
      }
      if (tag) {
        filtered = filtered.filter((p) => p.tags && p.tags.includes(tag));
      }
      if (search) {
        const s = search.toLowerCase();
        filtered = filtered.filter(
          (p) =>
            p.name?.toLowerCase().includes(s) ||
            p.description?.toLowerCase().includes(s) ||
            (p.tamil_name && p.tamil_name.toLowerCase().includes(s)) ||
            p.sku?.toLowerCase().includes(s) ||
            p.slug?.toLowerCase().includes(s) ||
            (Array.isArray(p.variants) && p.variants.some((v) => v.sku?.toLowerCase().includes(s)))
        );
      }
      products = filtered;
    }

    // Sorting
    if (sort === 'price-asc') {
      products.sort((a, b) => (a.variants?.[0]?.price || 0) - (b.variants?.[0]?.price || 0));
    } else if (sort === 'price-desc') {
      products.sort((a, b) => (b.variants?.[0]?.price || 0) - (a.variants?.[0]?.price || 0));
    } else if (sort === 'name') {
      products.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === 'newest') {
      products.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    // Pagination
    const total = products.length;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const start = (pageNum - 1) * limitNum;
    const paginated = products.slice(start, start + limitNum);

    res.status(200).json({
      products: paginated,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      total,
    });
  } catch (error) {
    console.error('[Product] getProducts error:', error);
    res.status(500).json({ message: 'Error retrieving products' });
  }
}

export async function getProductById(req, res) {
  try {
    let product = null;
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('id', req.params.id)
          .single();
        if (!error && data) {
          product = data;
        }
      } catch (e) {
        // Ignore network errors and continue to fallback
      }
    }

    if (!product) {
      product = SEED_PRODUCTS.find(
        (p) => p.id === req.params.id || p.slug === req.params.id
      );
    }

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.status(200).json(product);
  } catch (error) {
    console.error('[Product] getProductById error:', error);
    res.status(500).json({ message: 'Error fetching product' });
  }
}

export async function createProduct(req, res) {
  try {
    const body = req.body;
    const rawSlug = body.slug || body.name || body.id || 'product';
    const slug = rawSlug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const variants = Array.isArray(body.variants) ? body.variants : [];
    const stock = body.stock !== undefined ? Number(body.stock) : 0;

    const payload = {
      ...body,
      slug,
      stock,
      variants,
    };

    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('products')
        .insert(payload)
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          return res.status(400).json({ message: 'Product with this ID or slug already exists' });
        }
        throw error;
      }
      return res.status(201).json(data);
    } else {
      const newProduct = {
        id: body.id || `local-${Date.now()}`,
        ...payload,
        created_at: new Date().toISOString(),
      };
      SEED_PRODUCTS.unshift(newProduct);
      return res.status(201).json(newProduct);
    }
  } catch (error) {
    console.error('[Product] createProduct error:', error);
    res.status(500).json({ message: 'Error creating product' });
  }
}

export async function updateProduct(req, res) {
  try {
    const payload = {
      ...req.body,
      updated_at: new Date().toISOString(),
    };
    if (req.body.stock !== undefined) {
      payload.stock = Number(req.body.stock);
    }
    if (req.body.variants !== undefined) {
      payload.variants = Array.isArray(req.body.variants) ? req.body.variants : [];
    }

    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('products')
        .update(payload)
        .eq('id', req.params.id)
        .select()
        .single();

      if (error || !data) {
        return res.status(404).json({ message: 'Product not found' });
      }
      return res.status(200).json(data);
    } else {
      const idx = SEED_PRODUCTS.findIndex((p) => p.id === req.params.id || p.slug === req.params.id);
      if (idx === -1) {
        return res.status(404).json({ message: 'Product not found' });
      }
      SEED_PRODUCTS[idx] = { ...SEED_PRODUCTS[idx], ...payload };
      return res.status(200).json(SEED_PRODUCTS[idx]);
    }
  } catch (error) {
    console.error('[Product] updateProduct error:', error);
    res.status(500).json({ message: 'Error updating product' });
  }
}

export async function deleteProduct(req, res) {
  try {
    if (isSupabaseConfigured) {
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', req.params.id);

      if (error) throw error;
    } else {
      const idx = SEED_PRODUCTS.findIndex((p) => p.id === req.params.id || p.slug === req.params.id);
      if (idx !== -1) {
        SEED_PRODUCTS.splice(idx, 1);
      }
    }
    res.status(200).json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('[Product] deleteProduct error:', error);
    res.status(500).json({ message: 'Error deleting product' });
  }
}

export async function uploadProductImage(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided' });
    }

    const imageUrl = await uploadToCloudinary(req.file.buffer, 'svem-products');

    // Update product image in DB
    const { data, error } = await supabase
      .from('products')
      .update({ image: imageUrl, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    res.status(200).json({ imageUrl, product: data });
  } catch (error) {
    console.error('[Product] uploadImage error:', error);
    res.status(500).json({ message: 'Error uploading image' });
  }
}
