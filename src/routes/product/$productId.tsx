import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { getSupabase } from "@/integrations/supabase/client";
import { type Product, PRODUCTS } from "@/lib/products";
import { useShop } from "@/lib/store";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Breadcrumbs, generateBreadcrumbJsonLd } from "@/components/Breadcrumbs";
import { SEO } from "@/components/SEO";
import { ProductReviews } from "@/components/shop/ProductReviews";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Heart,
  ShoppingCart,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ImageOff,
  ArrowLeft,
  ShieldCheck,
  Truck,
  RotateCcw,
} from "lucide-react";

export const Route = createFileRoute("/product/$productId")({
  component: ProductDetailPage,
});

function ProductDetailPage() {
  const { productId } = Route.useParams();
  const navigate = useNavigate();
  const { addToCart, toggleWishlist, isWishlisted } = useShop();

  const [product, setProduct] = useState<Product | null>(null);
  const [relatedProducts, setRelatedProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVariantIdx, setSelectedVariantIdx] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [imageError, setImageError] = useState(false);
  const [isAdded, setIsAdded] = useState(false);

  useEffect(() => {
    async function fetchProduct() {
      setLoading(true);
      setImageError(false);
      setSelectedVariantIdx(0);
      setQuantity(1);

      try {
        let rawProd: any = null;
        let allProds: any[] = [];

        // 1. Fetch from Supabase
        try {
          const supabase = await getSupabase();
          const { data } = await supabase
            .from("products")
            .select("*")
            .or(`id.eq.${productId},slug.eq.${productId}`)
            .maybeSingle();

          if (data) rawProd = data;

          const { data: allData } = await supabase
            .from("products")
            .select("*")
            .limit(50);
          if (allData) allProds = allData;
        } catch (e) {
          console.warn("[ProductDetail] Supabase notice:", e);
        }

        // 2. Fetch from Backend API if not found
        const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";
        if (!rawProd) {
          try {
            const res = await fetch(`${backendUrl}/api/products/${productId}`);
            if (res.ok) {
              rawProd = await res.json();
            }
          } catch (e) {
            console.warn("[ProductDetail] Backend API notice:", e);
          }
        }

        if (allProds.length === 0) {
          try {
            const resAll = await fetch(`${backendUrl}/api/products?limit=50`);
            if (resAll.ok) {
              const resJson = await resAll.json();
              allProds = Array.isArray(resJson) ? resJson : (resJson.products || []);
            }
          } catch {}
        }

        // 3. Fallback to PRODUCTS static catalog
        if (!rawProd) {
          rawProd = PRODUCTS.find((p) => p.id === productId || p.slug === productId) || null;
        }

        if (rawProd) {
          let parsedVariants = [];
          if (Array.isArray(rawProd.variants) && rawProd.variants.length > 0) {
            parsedVariants = rawProd.variants;
          } else if (typeof rawProd.variants === "string") {
            try {
              const pv = JSON.parse(rawProd.variants);
              if (Array.isArray(pv) && pv.length > 0) parsedVariants = pv;
            } catch {}
          }

          if (parsedVariants.length === 0) {
            parsedVariants = [
              {
                size: rawProd.weight || "Standard",
                price: Number(rawProd.price) || 0,
                stock: Number(rawProd.stock) || 0,
                is_active: true,
              },
            ];
          }

          let imgUrl = rawProd.image;
          try {
            const parsedImgs = typeof rawProd.images === "string" ? JSON.parse(rawProd.images) : rawProd.images;
            if (Array.isArray(parsedImgs) && parsedImgs.length > 0) {
              imgUrl = parsedImgs[0];
            }
          } catch {}

          const formatted: Product = {
            ...rawProd,
            id: String(rawProd.id || ""),
            slug: String(rawProd.slug || ""),
            name: String(rawProd.name || "Product"),
            description: String(rawProd.description || ""),
            category: rawProd.category || "oils",
            image: imgUrl,
            tamilName: typeof rawProd.tamil_name === "string" ? rawProd.tamil_name : rawProd.tamilName,
            variants: parsedVariants,
            stock: rawProd.stock !== undefined ? Number(rawProd.stock) : 0,
            enabled: rawProd.is_active ?? rawProd.enabled ?? true,
          };

          setProduct(formatted);

          // Related products
          const related = (allProds.length > 0 ? allProds : PRODUCTS)
            .filter((p: any) => p.id !== formatted.id && p.category === formatted.category && (p.is_active !== false && p.enabled !== false))
            .slice(0, 4)
            .map((p: any) => ({
              ...p,
              variants: Array.isArray(p.variants) ? p.variants : [{ size: "Standard", price: p.price || 0, stock: p.stock || 0 }],
            }));
          setRelatedProducts(related);
        }
      } catch (err) {
        console.error("[ProductDetail] Error loading product:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchProduct();
  }, [productId]);

  // Active variants
  const activeVariants = useMemo(() => {
    if (!product || !product.variants) return [];
    const active = product.variants.filter((v: any) => v.is_active !== false);
    return active.length > 0 ? active : product.variants;
  }, [product]);

  const currentVariant = activeVariants[selectedVariantIdx] || activeVariants[0] || {
    size: "Standard",
    price: product?.price || 0,
    stock: product?.stock || 0,
  };

  const variantStock = (currentVariant as any)?.stock !== undefined
    ? Number((currentVariant as any).stock)
    : Number(product?.stock) || 0;

  const isOutOfStock = variantStock <= 0;
  const isLowStock = variantStock > 0 && variantStock <= 5;
  const wishlisted = product ? isWishlisted(product.id, currentVariant.size) : false;

  const handleAddToCart = () => {
    if (!product) return;
    if (isOutOfStock) {
      toast.error("This pack size is currently out of stock.");
      return;
    }
    if (quantity <= 0) {
      toast.error("Please select a quantity greater than zero.");
      return;
    }
    if (quantity > variantStock) {
      toast.error(`Only ${variantStock} unit(s) available for this pack size.`);
      return;
    }

    addToCart({
      id: product.id,
      name: product.name,
      size: currentVariant.size,
      price: currentVariant.price,
      qty: quantity,
      image: product.image,
    });

    setIsAdded(true);
    toast.success(`${product.name} (${currentVariant.size}) added to cart!`);
    setTimeout(() => setIsAdded(false), 1800);
  };

  const handleBuyNow = () => {
    handleAddToCart();
    if (!isOutOfStock && quantity > 0 && quantity <= variantStock) {
      navigate({ to: "/checkout" });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <div className="mx-auto max-w-7xl px-4 py-24 text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
          <p className="mt-4 text-sm text-muted-foreground">Loading authentic product details...</p>
        </div>
        <SiteFooter />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <div className="mx-auto max-w-7xl px-4 py-24 text-center">
          <h1 className="font-serif text-3xl font-bold text-foreground">Product Not Found</h1>
          <p className="mt-2 text-muted-foreground">The requested product could not be located in our catalog.</p>
          <Button asChild className="mt-6">
            <Link to="/shop">
              <ArrowLeft className="mr-2 h-4 w-4" /> Return to Shop
            </Link>
          </Button>
        </div>
        <SiteFooter />
      </div>
    );
  }

  const categoryName = product.category === "oils"
    ? "Cold Pressed Oils"
    : product.category === "dryfruits"
    ? "Dry Fruits & Nuts"
    : product.category === "palm-products"
    ? "Palm Products"
    : product.category === "honey"
    ? "Natural Honey"
    : "Millets & Traditional Grains";

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Shop", href: "/shop" },
    { label: categoryName, href: "/shop" },
    { label: product.name, href: `/product/${product.id}` },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col justify-between">
      <SEO
        title={`${product.name} — SRI VENKETESWARA OIL MILL`}
        description={product.description || `Shop 100% natural, farm-fresh ${product.name} from Sri Venkateswara Oil Mill.`}
        jsonLd={generateBreadcrumbJsonLd(breadcrumbs)}
      />
      <div>
        <SiteHeader />

        {/* Breadcrumbs Banner */}
        <div className="border-b border-border bg-[var(--cream)]/40 py-3">
          <div className="mx-auto max-w-7xl px-4 md:px-8">
            <Breadcrumbs items={breadcrumbs} />
          </div>
        </div>

        {/* Main Product Container */}
        <main className="mx-auto max-w-7xl px-4 py-8 md:px-8 md:py-12">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:gap-12">
            {/* Left: Product Image */}
            <div className="space-y-4">
              <div className="relative aspect-[4/5] overflow-hidden rounded-2xl border border-border bg-[var(--cream)] flex items-center justify-center p-6 shadow-xs">
                {product.image && !imageError ? (
                  <img
                    src={product.image}
                    alt={product.name}
                    onError={() => setImageError(true)}
                    className="max-h-full max-w-full object-contain transition-transform duration-500 hover:scale-105"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground">
                    <ImageOff className="h-16 w-16 opacity-30" />
                    <span className="text-sm tracking-wide">Image preview coming soon</span>
                  </div>
                )}

                {/* Marketing Badges */}
                <div className="absolute left-4 top-4 flex flex-col gap-2">
                  {product.tags && product.tags.length > 0 && product.tags.map((tag) => (
                    <Badge
                      key={tag}
                      className="border-0 bg-[var(--gold)] text-[oklch(0.22_0.04_50)] font-medium text-xs px-3 py-1 shadow-sm"
                    >
                      {tag}
                    </Badge>
                  ))}
                  {product.rating && (
                    <Badge variant="secondary" className="bg-background/90 backdrop-blur-xs font-semibold text-xs border border-border">
                      ★ {product.rating.toFixed(1)}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Product Information & Controls */}
            <div className="flex flex-col space-y-6">
              <div>
                <p className="text-xs uppercase tracking-widest text-primary font-semibold">
                  {categoryName}
                </p>
                <h1 className="mt-1 font-serif text-3xl md:text-4xl font-bold text-foreground">
                  {product.name}
                </h1>
                {product.tamilName && (
                  <p className="mt-1 text-lg font-medium text-primary/80">
                    {product.tamilName}
                  </p>
                )}
                {product.description && (
                  <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                    {product.description}
                  </p>
                )}
              </div>

              <div className="border-t border-b border-border py-4 space-y-4">
                {/* Variant / Pack Size Selector */}
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground">Select Pack Size</span>
                    {(currentVariant as any)?.sku && (
                      <span className="text-xs font-mono text-muted-foreground">
                        SKU: {(currentVariant as any).sku}
                      </span>
                    )}
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-2.5">
                    {activeVariants.map((v, idx) => {
                      const vStock = (v as any)?.stock !== undefined ? Number((v as any).stock) : (Number(product.stock) || 0);
                      const isVOutOfStock = vStock <= 0;
                      return (
                        <button
                          key={v.size}
                          type="button"
                          onClick={() => {
                            setSelectedVariantIdx(idx);
                            setQuantity(1);
                          }}
                          className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-all ${
                            idx === selectedVariantIdx
                              ? "border-primary bg-primary text-primary-foreground font-semibold shadow-xs"
                              : "border-border bg-card text-foreground hover:border-primary/40"
                          } ${isVOutOfStock ? "opacity-75" : ""}`}
                        >
                          <span>{v.size}</span>
                          <span className={`text-xs ${idx === selectedVariantIdx ? "text-primary-foreground/90" : "text-muted-foreground"}`}>
                            ₹{v.price}
                          </span>
                          {isVOutOfStock && (
                            <span className="text-[10px] font-normal opacity-80">(Out of Stock)</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Price Display */}
                <div className="flex items-baseline gap-3">
                  <div className="font-serif text-3xl font-bold text-foreground">
                    ₹{currentVariant.price}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    inclusive of all taxes / per {currentVariant.size}
                  </div>
                </div>

                {/* Real-time Stock Status */}
                <div>
                  {isOutOfStock ? (
                    <div className="flex items-center gap-2 text-destructive font-medium text-sm">
                      <XCircle className="h-4 w-4" />
                      <span>Currently Out of Stock (0 units available)</span>
                    </div>
                  ) : isLowStock ? (
                    <div className="flex items-center gap-2 text-amber-600 dark:text-amber-500 font-medium text-sm">
                      <AlertTriangle className="h-4 w-4" />
                      <span>Low Stock: Only {variantStock} unit{variantStock > 1 ? "s" : ""} remaining!</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-500 font-medium text-sm">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>In Stock ({variantStock} units available)</span>
                    </div>
                  )}
                </div>

                {/* Quantity Selector & Action Buttons */}
                <div className="space-y-3 pt-2">
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-semibold text-foreground">Quantity:</span>
                    <div className="flex items-center rounded-xl border border-border bg-card">
                      <button
                        type="button"
                        onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                        disabled={quantity <= 1 || isOutOfStock}
                        className="h-10 w-10 text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center font-bold"
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>
                      <span className="w-10 text-center text-sm font-semibold">{isOutOfStock ? 0 : quantity}</span>
                      <button
                        type="button"
                        onClick={() => setQuantity((q) => isOutOfStock ? 1 : Math.min(variantStock, q + 1))}
                        disabled={isOutOfStock || quantity >= variantStock}
                        className="h-10 w-10 text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center font-bold"
                        aria-label="Increase quantity"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <Button
                      size="lg"
                      onClick={handleAddToCart}
                      disabled={isOutOfStock}
                      className={`w-full font-semibold h-12 transition-all ${
                        isOutOfStock
                          ? "opacity-60 cursor-not-allowed bg-muted text-muted-foreground hover:bg-muted"
                          : isAdded
                          ? "bg-green-600 hover:bg-green-700 text-white"
                          : ""
                      }`}
                    >
                      {isOutOfStock ? (
                        "Out of Stock"
                      ) : isAdded ? (
                        <>
                          <CheckCircle2 className="mr-2 h-5 w-5" /> Added to Cart!
                        </>
                      ) : (
                        <>
                          <ShoppingCart className="mr-2 h-5 w-5" /> Add to Cart
                        </>
                      )}
                    </Button>

                    <Button
                      size="lg"
                      variant="secondary"
                      onClick={handleBuyNow}
                      disabled={isOutOfStock}
                      className={`w-full font-semibold h-12 ${isOutOfStock ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                      {isOutOfStock ? "Out of Stock" : "Buy Now"}
                    </Button>
                  </div>

                  <Button
                    variant={wishlisted ? "secondary" : "outline"}
                    onClick={() => {
                      if (!product) return;
                      toggleWishlist({ id: product.id, size: currentVariant.size });
                      toast.success(
                        wishlisted
                          ? `${product.name} (${currentVariant.size}) removed from wishlist`
                          : `${product.name} (${currentVariant.size}) saved to wishlist`
                      );
                    }}
                    className="w-full"
                  >
                    <Heart className={`mr-2 h-4 w-4 ${wishlisted ? "fill-destructive text-destructive" : ""}`} />
                    {wishlisted ? "Remove from Wishlist" : "Add to Wishlist"}
                  </Button>
                </div>
              </div>

              {/* Mill Quality Assurance Guarantees */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2 rounded-lg border border-border p-3">
                  <ShieldCheck className="h-5 w-5 text-primary shrink-0" />
                  <div>
                    <span className="font-semibold text-foreground block">100% Traditional</span>
                    Wood-pressed & natural
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-border p-3">
                  <Truck className="h-5 w-5 text-primary shrink-0" />
                  <div>
                    <span className="font-semibold text-foreground block">Fast Delivery</span>
                    Secure tamper-proof pack
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-border p-3">
                  <RotateCcw className="h-5 w-5 text-primary shrink-0" />
                  <div>
                    <span className="font-semibold text-foreground block">Direct From Mill</span>
                    Estd. 1919 authenticity
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Product Reviews */}
          <div className="mt-16 border-t border-border pt-12">
            <h2 className="font-serif text-2xl md:text-3xl font-bold text-foreground mb-6">
              Customer Reviews & Ratings
            </h2>
            <ProductReviews productId={product.id} />
          </div>

          {/* Related Products */}
          {relatedProducts.length > 0 && (
            <div className="mt-16 border-t border-border pt-12">
              <h2 className="font-serif text-2xl font-bold text-foreground mb-6">
                More in {categoryName}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {relatedProducts.map((rel) => {
                  const defaultVar = rel.variants[0] || { size: "Standard", price: rel.price || 0 };
                  return (
                    <Link
                      key={rel.id}
                      to="/product/$productId"
                      params={{ productId: rel.id }}
                      className="group flex flex-col rounded-xl border border-border bg-card p-4 transition-all hover:shadow-md hover:border-primary/40"
                    >
                      <div className="relative aspect-square overflow-hidden rounded-lg bg-[var(--cream)] flex items-center justify-center p-3 mb-3">
                        {rel.image ? (
                          <img
                            src={rel.image}
                            alt={rel.name}
                            className="h-full w-full object-contain transition-transform group-hover:scale-105"
                          />
                        ) : (
                          <ImageOff className="h-8 w-8 text-muted-foreground opacity-30" />
                        )}
                      </div>
                      <h3 className="font-serif text-base font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-1">
                        {rel.name}
                      </h3>
                      {rel.tamilName && (
                        <p className="text-xs text-primary/80 line-clamp-1">{rel.tamilName}</p>
                      )}
                      <div className="mt-auto pt-2 flex items-center justify-between text-sm">
                        <span className="font-bold text-foreground">₹{defaultVar.price}</span>
                        <span className="text-xs text-muted-foreground">{defaultVar.size}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </main>
      </div>
      <SiteFooter />
    </div>
  );
}
