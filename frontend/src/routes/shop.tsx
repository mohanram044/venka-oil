import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { getSupabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Heart, ImageOff, CheckCircle2 } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type Product, PRODUCTS } from "@/lib/products";
import { useShop } from "@/lib/store";
import { ProductReviews } from "@/components/shop/ProductReviews";
import { SEO } from "@/components/SEO";
import { Breadcrumbs, generateBreadcrumbJsonLd } from "@/components/Breadcrumbs";

export const Route = createFileRoute("/shop")({
  component: Shop,
});

type Cat = "all" | "oils" | "dryfruits" | "palm-products" | "honey" | "millets";
type Sort = "featured" | "price-asc" | "price-desc" | "name";

function Shop() {
  const navigate = useNavigate();
  const [cat, setCat] = useState<Cat>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("featured");

  const [dbProducts, setDbProducts] = useState<Product[]>([]);

  useEffect(() => {
    const loadProducts = async () => {
      try {
        let rawData: any[] = [];
        try {
          const supabase = await getSupabase();
          const { data, error } = await supabase
            .from("products")
            .select("*");
          if (!error && data && data.length > 0) {
            rawData = data;
          }
        } catch {}

        if (rawData.length === 0) {
          try {
            const apiRes = await fetch("/api/products?limit=200");
            if (apiRes.ok) {
              const apiJson = await apiRes.json();
              if (apiJson.products && apiJson.products.length > 0) {
                rawData = apiJson.products;
              }
            }
          } catch {}
        }

        if (rawData.length === 0) {
          setDbProducts(PRODUCTS);
          return;
        }

        const mapped = rawData.map((d: any) => {
          let parsedVariants: any[] = [];
          if (Array.isArray(d.variants) && d.variants.length > 0) {
            parsedVariants = d.variants;
          } else if (typeof d.variants === 'string') {
            try {
              const pv = JSON.parse(d.variants);
              if (Array.isArray(pv) && pv.length > 0) parsedVariants = pv;
            } catch {}
          }

          if (parsedVariants.length === 0) {
            // Check if matching preset product in PRODUCTS has variants
            const preset = PRODUCTS.find(p => p.slug === d.slug || p.id === d.id);
            if (preset?.variants && preset.variants.length > 0) {
              parsedVariants = preset.variants;
            } else {
              parsedVariants = [{ 
                size: d.weight || "Standard", 
                price: Number(d.price) || 0,
                stock: Number(d.stock) || 0,
                is_active: true,
              }];
            }
          }

          let image = undefined;
          try {
            const parsedImgs = typeof d.images === 'string' ? JSON.parse(d.images) : d.images;
            if (Array.isArray(parsedImgs) && parsedImgs.length > 0) {
              image = parsedImgs[0];
            } else if (typeof d.image === 'string' && d.image) {
              image = d.image;
            }
          } catch (e) {}

          const validCategories = ["oils", "dryfruits", "palm-products", "honey", "millets"];
          const category = validCategories.includes(d.category) ? d.category : "oils";

          return {
            ...d,
            id: String(d.id || ""),
            slug: String(d.slug || ""),
            name: String(d.name || "Unknown Product"),
            description: String(d.description || ""),
            category,
            image,
            tamilName: typeof d.tamil_name === 'string' ? d.tamil_name : (d.tamilName || undefined),
            variants: parsedVariants,
            stock: d.stock !== undefined ? Number(d.stock) : 0,
            enabled: d.is_active ?? d.enabled ?? true,
          };
        }) as Product[];

        setDbProducts(mapped);
      } catch (err) {
        console.warn("[Shop] Load error, falling back to static catalog:", err);
        setDbProducts(PRODUCTS);
      }
    };

    loadProducts();
  }, []);

  const products = useMemo(() => {
    // Only display active products in shop
    let list = dbProducts.filter((p) => {
      const isActive = p.enabled !== false && (p as any).is_active !== false;
      const matchesCat = cat === "all" || p.category === cat;
      return isActive && matchesCat;
    });

    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter((p) => 
        p.name.toLowerCase().includes(s) ||
        (p.tamilName && p.tamilName.toLowerCase().includes(s)) ||
        ((p as any).tamil_name && (p as any).tamil_name.toLowerCase().includes(s)) ||
        ((p as any).sku && (p as any).sku.toLowerCase().includes(s)) ||
        (p.description && p.description.toLowerCase().includes(s)) ||
        (p.variants && p.variants.some((v: any) => v.sku && String(v.sku).toLowerCase().includes(s)))
      );
    }
    if (sort === "price-asc")
      list = [...list].sort((a, b) => (a.variants?.[0]?.price || 0) - (b.variants?.[0]?.price || 0));
    if (sort === "price-desc")
      list = [...list].sort((a, b) => (b.variants?.[0]?.price || 0) - (a.variants?.[0]?.price || 0));
    if (sort === "name") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [dbProducts, cat, search, sort]);

  const breadcrumbs = [
    { label: "Shop", href: "/shop" }
  ];

  return (
    <div className="min-h-screen bg-background">
      <SEO 
        title="Shop — SRI VENKETESWARA OIL MILL"
        description="Shop traditional cold-pressed oils, premium dry fruits, natural honey, and millets from SRI VENKETESWARA OIL MILL."
        jsonLd={generateBreadcrumbJsonLd(breadcrumbs)}
      />
      <SiteHeader />

      <section
        className="border-b border-border"
        style={{ background: "var(--gradient-hero)" }}
      >
        <div className="mx-auto max-w-7xl px-4 pt-6 md:px-8">
          <Breadcrumbs items={breadcrumbs} />
        </div>
        <div className="mx-auto max-w-7xl px-4 py-8 md:px-8 md:py-12">
          <p className="text-xs tracking-[0.3em] text-[var(--gold-deep)]">
            FROM OUR MILL TO YOUR TABLE
          </p>
          <h1 className="mt-3 font-serif text-4xl md:text-5xl text-foreground">
            Cold-pressed oils, premium dry fruits, pure natural honey & millets
          </h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Traditionally wood-pressed, naturally filtered, lovingly bottled. Choose
            your size and add to cart.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-8 md:px-8">
        <div className="mb-6 flex flex-col items-start gap-4 md:flex-row md:items-center">
          <div className="flex flex-wrap gap-2">
            {(["all", "oils", "dryfruits", "palm-products", "honey", "millets"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={`rounded-full border px-4 py-1.5 text-sm transition ${
                  cat === c
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:border-primary/40"
                }`}
              >
                {c === "all"
                  ? "All Products"
                  : c === "oils"
                  ? "Cold Pressed Oils"
                  : c === "dryfruits"
                  ? "Dry Fruits & Nuts"
                  : c === "palm-products"
                  ? "Palm Products"
                  : c === "honey"
                  ? "Natural Honey"
                  : "Millets & Traditional Grains"}
              </button>
            ))}
          </div>
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:w-auto md:ml-auto">
            <Input
              placeholder="Search products…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full md:w-64"
            />
            <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
              <SelectTrigger className="w-full sm:w-[180px] md:w-48">
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="featured">Featured</SelectItem>
                <SelectItem value="price-asc">Price: Low to High</SelectItem>
                <SelectItem value="price-desc">Price: High to Low</SelectItem>
                <SelectItem value="name">Name (A–Z)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
        {products.length === 0 && (
          <div className="py-20 text-center text-muted-foreground">
            No products match your search.
          </div>
        )}
      </section>
    </div>
  );
}

function ProductCard({ product }: { product: Product }) {
  const navigate = useNavigate();
  const [variantIdx, setVariantIdx] = useState(0);
  const [imageError, setImageError] = useState(false);
  const { addToCart, toggleWishlist, isWishlisted } = useShop();
  const [isAdded, setIsAdded] = useState(false);

  // Filter out any inactive variants
  const activeVariants = useMemo(() => {
    const active = product.variants.filter((v: any) => v.is_active !== false);
    return active.length > 0 ? active : product.variants;
  }, [product.variants]);

  const currentIdx = variantIdx < activeVariants.length ? variantIdx : 0;
  const variant = activeVariants[currentIdx] || activeVariants[0];
  const wishlisted = isWishlisted(product.id, variant.size);

  const variantStock = (variant as any)?.stock !== undefined 
    ? Number((variant as any).stock) 
    : (Number(product.stock) || 0);

  const isOutOfStock = variantStock <= 0;
  const [qty, setQty] = useState(isOutOfStock ? 0 : 1);

  // Keep qty in sync if current variant stock changes
  useEffect(() => {
    if (isOutOfStock) {
      setQty(0);
    } else if (qty === 0) {
      setQty(1);
    } else if (qty > variantStock) {
      setQty(variantStock);
    }
  }, [variantStock, isOutOfStock]);

  const handleAddToCart = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (isOutOfStock) {
      toast.error("This pack size is currently out of stock.");
      return;
    }
    const finalQty = qty > 0 ? qty : 1;
    if (finalQty > variantStock) {
      toast.error(`Only ${variantStock} unit(s) available.`);
      return;
    }
    
    addToCart({
      id: product.id,
      name: product.name,
      size: variant.size,
      price: variant.price,
      qty: finalQty,
      image: product.image,
    });
    
    if (navigator.vibrate) navigator.vibrate(30);
    setIsAdded(true);
    setTimeout(() => setIsAdded(false), 1500);

    const button = e.currentTarget;
    const rect = button.getBoundingClientRect();
    const cartIcon = document.querySelector('.lucide-shopping-cart');
    
    if (cartIcon) {
      const cartRect = cartIcon.getBoundingClientRect();
      const flyingDot = document.createElement('div');
      flyingDot.className = 'fixed z-50 rounded-full bg-primary flex items-center justify-center shadow-lg pointer-events-none transition-all duration-[600ms] ease-[cubic-bezier(0.25,1,0.5,1)]';
      flyingDot.style.width = '24px';
      flyingDot.style.height = '24px';
      flyingDot.style.left = `${rect.left + rect.width / 2 - 12}px`;
      flyingDot.style.top = `${rect.top + rect.height / 2 - 12}px`;
      
      if (product.image && !imageError) {
        const img = document.createElement('img');
        img.src = product.image;
        img.className = 'w-full h-full object-cover rounded-full';
        flyingDot.appendChild(img);
      }
      
      document.body.appendChild(flyingDot);
      
      requestAnimationFrame(() => {
        flyingDot.style.left = `${cartRect.left + cartRect.width / 2 - 12}px`;
        flyingDot.style.top = `${cartRect.top + cartRect.height / 2 - 12}px`;
        flyingDot.style.transform = 'scale(0.3)';
        flyingDot.style.opacity = '0';
      });
      
      setTimeout(() => {
        if (document.body.contains(flyingDot)) {
          document.body.removeChild(flyingDot);
        }
      }, 600);
    }
  };

  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition hover:shadow-[var(--shadow-elegant)]">
      <Link 
        to="/product/$productId"
        params={{ productId: product.id }}
        className="relative aspect-[4/5] overflow-hidden bg-[var(--cream)] block cursor-pointer"
      >
        {product.image && !imageError ? (
          <img
            src={product.image}
            alt={product.imageAlt ?? product.name}
            loading="lazy"
            onError={() => setImageError(true)}
            className="h-full w-full object-contain p-4 transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground p-4">
            <ImageOff className="h-10 w-10 opacity-40" />
            <span className="text-xs tracking-wide">Image coming soon</span>
          </div>
        )}
        {product.tags?.map((t) => (
          <Badge
            key={t}
            className="absolute left-3 top-3 border-0 bg-[var(--gold)] text-[oklch(0.22_0.04_50)] font-medium"
          >
            {t}
          </Badge>
        ))}
      </Link>

      <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
        <div>
          <div className="flex items-start justify-between gap-3">
            <div>
              <Link 
                to="/product/$productId"
                params={{ productId: product.id }}
                className="hover:text-primary transition-colors"
              >
                <h3 className="font-serif text-xl text-foreground font-medium leading-snug">{product.name}</h3>
              </Link>
              {(product.tamilName || (product as any).tamil_name) ? (
                <p className="text-sm text-primary/80 font-medium mt-0.5">
                  {product.tamilName || (product as any).tamil_name}
                </p>
              ) : null}
            </div>
            {product.rating ? (
              <div className="flex items-center gap-1 text-[0.75rem] text-[var(--gold)] shrink-0 mt-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <span key={i}>{i < Math.round(product.rating || 0) ? "★" : "☆"}</span>
                ))}
              </div>
            ) : null}
          </div>
          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
            {product.description}
          </p>
        </div>

        <div className="mt-auto space-y-3">
          {/* Pack Size Selectors */}
          <div className="flex flex-wrap gap-2">
            {activeVariants.map((v, i) => {
              const vStock = (v as any)?.stock !== undefined ? Number((v as any).stock) : (Number(product.stock) || 0);
              const vOut = vStock <= 0;
              return (
                <button
                  key={v.size}
                  onClick={() => {
                    setVariantIdx(i);
                    setQty(vOut ? 0 : 1);
                  }}
                  className={`rounded-full border px-3 py-1 text-xs transition flex items-center gap-1 ${
                    i === currentIdx
                      ? "border-primary bg-primary text-primary-foreground font-medium shadow-xs"
                      : "border-border bg-background hover:border-primary/40 text-foreground"
                  } ${vOut ? "opacity-75" : ""}`}
                >
                  <span>{v.size}</span>
                  {vOut && <span className="text-[10px] opacity-70">(0)</span>}
                </button>
              );
            })}
          </div>

          {/* Pricing & Quantity Controls */}
          <div className="flex items-center justify-between">
            <div>
              <div className="font-serif text-2xl font-semibold text-foreground">
                ₹{variant.price}
              </div>
              <div className="text-xs text-muted-foreground">per {variant.size}</div>
            </div>
            <div className="flex items-center rounded-full border border-border">
              <button
                onClick={() => setQty((q) => Math.max(0, q - 1))}
                disabled={qty === 0 || isOutOfStock}
                className="h-8 w-8 text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Decrease quantity"
              >
                −
              </button>
              <span className="w-6 text-center text-sm font-medium">{qty}</span>
              <button
                onClick={() => setQty((q) => isOutOfStock ? 0 : (variantStock > 0 && q >= variantStock ? q : q + 1))}
                disabled={isOutOfStock || (variantStock > 0 && qty >= variantStock)}
                className="h-8 w-8 text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Increase quantity"
              >
                +
              </button>
            </div>
          </div>

          {/* Stock & SKU Info */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              {isOutOfStock ? (
                <Badge variant="destructive" className="rounded-full bg-red-50 text-red-700 border-red-200 font-normal">
                  Out of Stock (0)
                </Badge>
              ) : variantStock <= 5 ? (
                <Badge variant="outline" className="rounded-full bg-amber-50 text-amber-800 border-amber-300 font-normal">
                  Low Stock: Only {variantStock} left
                </Badge>
              ) : (
                <span className="text-emerald-700 font-medium flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> In Stock ({variantStock} units)
                </span>
              )}

              {(variant as any)?.sku && (
                <span className="text-[11px] text-muted-foreground font-mono">
                  {(variant as any).sku}
                </span>
              )}
            </div>

            {/* Action Buttons */}
            <div className="grid gap-2">
              <Button
                onClick={handleAddToCart}
                disabled={isOutOfStock}
                className={`w-full transition-all duration-300 ${
                  isOutOfStock
                    ? "opacity-60 cursor-not-allowed bg-muted text-muted-foreground border-border hover:bg-muted"
                    : isAdded
                    ? "bg-green-500 hover:bg-green-600 text-white border-green-500 shadow-md"
                    : ""
                }`}
              >
                {isOutOfStock ? (
                  "Out of Stock"
                ) : isAdded ? (
                  <>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Added!
                  </>
                ) : (
                  "Add to Cart"
                )}
              </Button>
              <Button
                variant="secondary"
                disabled={isOutOfStock}
                onClick={() => {
                  if (isOutOfStock) {
                    toast.error("This item is currently out of stock.");
                    return;
                  }
                  if (qty === 0) {
                    toast.error("Please increase the quantity before buying.");
                    return;
                  }
                  addToCart({
                    id: product.id,
                    name: product.name,
                    size: variant.size,
                    price: variant.price,
                    qty,
                    image: product.image,
                  });
                  toast.success(`${product.name} (${variant.size}) added to cart`);
                  navigate({ to: "/checkout" });
                }}
                className={`w-full ${isOutOfStock ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                {isOutOfStock ? "Out of Stock" : "Buy Now"}
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                asChild
                variant="outline"
                className="w-full text-xs font-medium"
              >
                <Link to="/product/$productId" params={{ productId: product.id }}>
                  View Details
                </Link>
              </Button>
              <Button
                variant={wishlisted ? "secondary" : "outline"}
                onClick={() => {
                  toggleWishlist({ id: product.id, size: variant.size });
                  toast.success(
                    wishlisted
                      ? `${product.name} (${variant.size}) removed from wishlist`
                      : `${product.name} (${variant.size}) added to wishlist`,
                  );
                }}
                className="w-full text-xs"
              >
                <Heart className={`mr-1.5 h-3.5 w-3.5 ${wishlisted ? "fill-destructive text-destructive" : ""}`} />
                {wishlisted ? "Saved" : "Save"}
              </Button>
            </div>
          </div>
          
          <div className="pt-2">
            <CollapsibleReviewsWrapper productId={product.id} initialRating={product.rating} />
          </div>
        </div>
      </div>
    </div>
  );
}

function CollapsibleReviewsWrapper({ productId, initialRating }: { productId: string, initialRating?: number }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [summary, setSummary] = useState<{ averageRating: number, totalReviews: number } | null>(null);

  useEffect(() => {
    getSupabase().then(supabase => {
      supabase.rpc("get_product_reviews_summary", { p_product_id: productId })
        .single()
        .then(({ data, error }) => {
          if (!error && data) {
            setSummary(data as any);
          } else if (error && error.code !== "PGRST116") {
            console.error(`[Shop] Failed to fetch review summary for product ${productId}:`, error);
          }
        });
    });
  }, [productId]);

  const rating = summary?.averageRating || initialRating || 0;
  const count = summary?.totalReviews || 0;

  return (
    <div className="w-full">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-[var(--cream)] py-3 text-sm font-semibold text-foreground hover:bg-[var(--gold)]/10 hover:border-[var(--gold)]/30 transition-all duration-300 shadow-sm"
      >
        {isExpanded ? (
          "▲ Hide Customer Reviews"
        ) : count > 0 ? (
          `⭐ Customer Reviews (${rating.toFixed(1)} • ${count} Review${count !== 1 ? "s" : ""}) ▼`
        ) : (
          "⭐ Customer Reviews (No Reviews Yet) ▼"
        )}
      </button>

      <div 
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
          isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <ProductReviews productId={productId} />
        </div>
      </div>
    </div>
  );
}
