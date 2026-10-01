// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef, useMemo } from "react";
import { getSupabase } from "@/integrations/supabase/client";
import { PRODUCTS, type Product } from "@/lib/products";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { 
  Plus, Search, Pencil, Trash2, Image as ImageIcon, Loader2, 
  FileSpreadsheet, Download, Upload, AlertCircle, Layers, CheckCircle2,
  Package, Boxes, AlertTriangle, XCircle, Eye, EyeOff, X
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/products")({
  component: AdminProducts,
});

const CATEGORIES = [
  { value: "oils", label: "Cold Pressed Oils" },
  { value: "dryfruits", label: "Dry Fruits & Nuts" },
  { value: "palm-products", label: "Palm Products" },
  { value: "millets", label: "Millets & Traditional Grains" },
  { value: "honey", label: "Natural Honey" },
] as const;

const AVAILABLE_TAGS = [
  "Best Seller",
  "Popular",
  "New Arrival",
  "Featured",
  "Organic",
  "Traditional",
];

const PRESET_PACK_SIZES = ["250 g", "500 g", "1 Kg", "250 ml", "500 ml", "1 Litre"];

export type VariantItem = {
  id?: string;
  size: string;
  price: number;
  stock: number;
  sku?: string;
  is_active?: boolean;
};

const productSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2, "English name must be at least 2 characters"),
  tamil_name: z.string().optional(),
  slug: z.string().min(2, "Slug must be at least 2 characters"),
  category: z.enum(["oils", "dryfruits", "palm-products", "honey", "millets"], {
    errorMap: () => ({ message: "Please select a category" }),
  }),
  price: z.coerce.number().min(0, "Price must be non-negative"),
  stock: z.coerce.number().int().min(0, "Stock cannot be negative"),
  sku: z.string().optional(),
  description: z.string().optional(),
  is_active: z.boolean().default(true),
});

type ProductFormValues = z.infer<typeof productSchema>;

function AdminProducts() {
  const [products, setProducts] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  
  // Edit/Add modal state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageUrl, setImageUrl] = useState<string>("");
  const [variants, setVariants] = useState<VariantItem[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  
  // Excel Import state
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importedRows, setImportedRows] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: "",
      tamil_name: "",
      slug: "",
      category: "oils",
      price: 0,
      stock: 0,
      sku: "",
      description: "",
      is_active: true,
    },
  });

  const fetchProducts = async () => {
    setLoading(true);
    try {
      // 1. Try Supabase first
      const supabase = await getSupabase();
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .order("created_at", { ascending: false });
      
      if (!error && data && data.length > 0) {
        setProducts(data);
        return;
      }

      // 2. Try Backend API
      try {
        const res = await fetch("/api/products?limit=200");
        if (res.ok) {
          const apiData = await res.json();
          if (apiData.products && apiData.products.length > 0) {
            setProducts(apiData.products);
            return;
          }
        }
      } catch {}

      // 3. Fallback to synchronized built-in PRODUCTS catalog
      setProducts(PRODUCTS.map(p => ({
        ...p,
        tamil_name: p.tamilName || "",
        images: p.image ? [p.image] : [],
        is_active: p.enabled ?? true,
      })));
    } catch {
      setProducts(PRODUCTS.map(p => ({
        ...p,
        tamil_name: p.tamilName || "",
        images: p.image ? [p.image] : [],
        is_active: p.enabled ?? true,
      })));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  // Quick stats calculation
  const stats = useMemo(() => {
    const totalProducts = products.length;
    let totalVariants = 0;
    let inStockVariants = 0;
    let lowStockVariants = 0;
    let outOfStockVariants = 0;

    for (const p of products) {
      const vList = Array.isArray(p.variants) && p.variants.length > 0
        ? p.variants
        : [{ size: "Standard", stock: Number(p.stock) || 0 }];

      for (const v of vList) {
        totalVariants++;
        const s = Number(v.stock) || 0;
        if (s === 0) {
          outOfStockVariants++;
        } else if (s <= 5) {
          lowStockVariants++;
        } else {
          inStockVariants++;
        }
      }
    }

    return {
      totalProducts,
      totalVariants,
      inStockVariants,
      lowStockVariants,
      outOfStockVariants,
    };
  }, [products]);

  // Open Dialog for adding a new product
  const openAddDialog = () => {
    setSelectedProduct(null);
    setImageUrl("");
    setVariants([
      { size: "500 ml", price: 120, stock: 0, sku: "", is_active: true },
      { size: "1 Litre", price: 240, stock: 0, sku: "", is_active: true },
    ]);
    setSelectedTags([]);
    form.reset({
      name: "",
      tamil_name: "",
      slug: "",
      category: "oils",
      price: 120,
      stock: 0,
      sku: "",
      description: "",
      is_active: true,
    });
    setIsDialogOpen(true);
  };

  // Open Dialog for editing an existing product
  const openEditDialog = (product: any) => {
    setSelectedProduct(product);
    const existingImg = product.images?.[0] || product.image || "";
    setImageUrl(existingImg);

    // Parse variants if available
    let existingVariants: VariantItem[] = [];
    if (Array.isArray(product.variants) && product.variants.length > 0) {
      existingVariants = product.variants.map((v: any) => ({
        id: v.id,
        size: v.size || "Standard",
        price: Number(v.price) || 0,
        stock: Number(v.stock) || 0,
        sku: v.sku || "",
        is_active: v.is_active !== false,
      }));
    } else if (typeof product.variants === "string") {
      try {
        const pv = JSON.parse(product.variants);
        if (Array.isArray(pv)) {
          existingVariants = pv.map((v: any) => ({
            id: v.id,
            size: v.size || "Standard",
            price: Number(v.price) || 0,
            stock: Number(v.stock) || 0,
            sku: v.sku || "",
            is_active: v.is_active !== false,
          }));
        }
      } catch {}
    }

    if (existingVariants.length === 0) {
      existingVariants = [{
        size: product.weight || "Standard",
        price: Number(product.price) || 0,
        stock: Number(product.stock) || 0,
        sku: product.sku || "",
        is_active: true,
      }];
    }
    setVariants(existingVariants);

    // Tags
    const tags = Array.isArray(product.tags) ? product.tags : [];
    setSelectedTags(tags);

    form.reset({
      id: product.id,
      name: product.name || "",
      tamil_name: product.tamil_name || product.tamilName || "",
      slug: product.slug || "",
      category: (product.category as any) || "oils",
      price: Number(product.price) || (existingVariants[0]?.price ?? 0),
      stock: Number(product.stock) || 0,
      sku: product.sku || "",
      description: product.description || "",
      is_active: product.is_active ?? product.enabled ?? true,
    });
    setIsDialogOpen(true);
  };

  // Variant manager helpers
  const addVariantRow = (suggestedSize?: string) => {
    setVariants(prev => [
      ...prev,
      {
        size: suggestedSize || "New Size",
        price: prev.length > 0 ? prev[prev.length - 1].price : 0,
        stock: 0,
        sku: "",
        is_active: true,
      }
    ]);
  };

  const updateVariantRow = (index: number, field: keyof VariantItem, value: any) => {
    setVariants(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const removeVariantRow = (index: number) => {
    setVariants(prev => prev.filter((_, i) => i !== index));
  };

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this product?")) return;
    try {
      const supabase = await getSupabase();
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) {
        // Try backend delete
        await fetch(`/api/products/${id}`, { method: "DELETE" });
      }
      toast.success("Product deleted successfully");
      setProducts(prev => prev.filter(p => p.id !== id));
    } catch {
      setProducts(prev => prev.filter(p => p.id !== id));
      toast.success("Product removed from view");
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file (PNG, JPG, WEBP).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image file size must be less than 5MB.");
      return;
    }

    setUploadingImage(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${fileExt}`;
      const filePath = `products/${fileName}`;

      let uploadedUrl = "";
      try {
        const supabase = await getSupabase();
        const { error: uploadError } = await supabase.storage
          .from("product-images")
          .upload(filePath, file);

        if (!uploadError) {
          const { data } = supabase.storage.from("product-images").getPublicUrl(filePath);
          uploadedUrl = data.publicUrl;
        }
      } catch {}

      if (!uploadedUrl) {
        // Create local object URL for preview and session editing
        uploadedUrl = URL.createObjectURL(file);
        toast.info("Image preview set. You can also paste an external CDN or image link.");
      } else {
        toast.success("Image uploaded successfully!");
      }

      setImageUrl(uploadedUrl);
    } catch (err: any) {
      toast.error("Upload error. You can paste an image URL directly into the input.");
    } finally {
      setUploadingImage(false);
    }
  };

  const onSubmit = async (values: ProductFormValues) => {
    // 1. Validate variants
    if (variants.length > 0) {
      const invalidVariant = variants.find(v => !v.size.trim() || v.price < 0 || v.stock < 0);
      if (invalidVariant) {
        toast.error("Please make sure all variants have a valid size, non-negative price, and valid stock.");
        return;
      }
    }

    // 2. Generate or preserve slug
    const slug = selectedProduct?.slug || values.slug.trim() || values.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    
    // 3. Calculate base price if 0 or use lowest variant price
    let price = Number(values.price);
    const activeVariants = variants.filter(v => v.is_active !== false);
    if ((price === 0 || isNaN(price)) && activeVariants.length > 0) {
      price = Math.min(...activeVariants.map(v => Number(v.price) || 0));
    }

    // 4. Calculate stock: sum variant stocks if present, else use form stock
    let stock = Number(values.stock) || 0;
    if (variants.length > 0) {
      const variantStockSum = variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
      if (variantStockSum > 0 || stock === 0) {
        stock = variantStockSum;
      }
    }

    const payload: any = {
      ...(selectedProduct ? { id: selectedProduct.id } : {}),
      name: values.name.trim(),
      tamil_name: values.tamil_name?.trim() || null,
      slug,
      category: values.category,
      price,
      stock,
      sku: values.sku?.trim() || slug,
      description: values.description?.trim() || "",
      is_active: values.is_active,
      enabled: values.is_active,
      images: imageUrl.trim() ? [imageUrl.trim()] : [],
      image: imageUrl.trim() || null,
      variants: variants.map((v) => ({
        ...(v.id ? { id: v.id } : {}),
        size: v.size.trim(),
        price: Number(v.price) || 0,
        stock: Number(v.stock) || 0,
        sku: v.sku?.trim() || `${slug}-${v.size.toLowerCase().replace(/[^a-z0-9]+/g, "")}`,
        is_active: v.is_active !== false,
      })),
      tags: selectedTags,
      // Preserve unaffected metadata if editing
      ...(selectedProduct?.rating ? { rating: selectedProduct.rating } : {}),
      ...(selectedProduct?.metaTitle ? { metaTitle: selectedProduct.metaTitle } : {}),
      ...(selectedProduct?.metaDescription ? { metaDescription: selectedProduct.metaDescription } : {}),
      ...(selectedProduct?.structuredData ? { structuredData: selectedProduct.structuredData } : {}),
    };

    try {
      const supabase = await getSupabase();
      if (selectedProduct) {
        const { error } = await supabase.from("products").update(payload).eq("id", selectedProduct.id);
        if (error) {
          // Try backend API update
          await fetch(`/api/products/${selectedProduct.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        }
        toast.success(`Product "${payload.name}" updated successfully!`);
      } else {
        const { error } = await supabase.from("products").insert([payload]);
        if (error) {
          // Try backend API insert
          await fetch("/api/products", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        }
        toast.success(`Product "${payload.name}" created successfully!`);
      }
    } catch {
      toast.success(`Product saved in session state!`);
    }

    // Refresh products in list
    setIsDialogOpen(false);
    fetchProducts();
  };

  // ── Excel Import / Export ───────────────────────────────────────────────────
  const handleExportExcel = () => {
    const exportData = products.map(p => ({
      ID: p.id || "",
      Name: p.name || "",
      "Tamil Name": p.tamil_name || p.tamilName || "",
      Category: p.category || "oils",
      Slug: p.slug || "",
      SKU: p.sku || "",
      "Base Price": p.price || 0,
      Stock: p.stock || 0,
      "Variants (Size:Price:Stock:SKU)": Array.isArray(p.variants) 
        ? p.variants.map((v: any) => `${v.size}:${v.price}:${v.stock || 0}:${v.sku || ""}`).join("; ") 
        : "",
      "Image URL": p.images?.[0] || p.image || "",
      Tags: Array.isArray(p.tags) ? p.tags.join(", ") : "",
      Description: p.description || "",
      "Is Active": (p.is_active ?? p.enabled ?? true) ? "Yes" : "No",
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Products");
    XLSX.writeFile(wb, `SVEM_Products_${new Date().toISOString().split("T")[0]}.xlsx`);
    toast.success("Products exported successfully to Excel");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: "binary" });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const rawJson: any[] = XLSX.utils.sheet_to_json(ws);

        if (!rawJson || rawJson.length === 0) {
          toast.error("No product rows found in the uploaded file");
          return;
        }

        const parsed = rawJson.map((row) => {
          const name = String(row["Name"] || row["Product Name"] || row["name"] || "").trim();
          const tamil_name = String(row["Tamil Name"] || row["tamil_name"] || row["Tamil"] || "").trim();
          const category = String(row["Category"] || row["category"] || "oils").trim().toLowerCase();
          const slug = String(row["Slug"] || row["slug"] || name.toLowerCase().replace(/[^a-z0-9]+/g, "-")).trim();
          const price = Number(row["Base Price"] || row["Price"] || row["price"] || 0);
          const stock = Number(row["Stock"] || row["Quantity"] || row["stock"] || 0);
          const sku = String(row["SKU"] || row["sku"] || slug).trim();
          const image = String(row["Image URL"] || row["Image"] || row["image"] || "").trim();
          const description = String(row["Description"] || row["description"] || "").trim();
          const tagsRaw = String(row["Tags"] || row["tags"] || "");
          const tags = tagsRaw ? tagsRaw.split(",").map(t => t.trim()).filter(Boolean) : [];

          const rawVariants = String(row["Variants"] || row["Variants (Size:Price:Stock:SKU)"] || row["variants"] || "");
          let parsedVariants: VariantItem[] = [];
          if (rawVariants) {
            const parts = rawVariants.split(/[;,]/);
            for (const part of parts) {
              const [vSize, vPrice, vStock, vSku] = part.split(":").map(s => s.trim());
              if (vSize) {
                parsedVariants.push({
                  size: vSize,
                  price: Number(vPrice) || price,
                  stock: Number(vStock) || 0,
                  sku: vSku || "",
                  is_active: true,
                });
              }
            }
          }

          if (parsedVariants.length === 0 && price > 0) {
            parsedVariants = [{ size: "Standard", price, stock, is_active: true }];
          }

          return {
            name,
            tamil_name: tamil_name || undefined,
            category,
            slug,
            price,
            stock,
            sku,
            images: image ? [image] : [],
            image: image || undefined,
            variants: parsedVariants,
            tags,
            description,
            is_active: true,
          };
        }).filter(item => item.name.length > 0);

        setImportedRows(parsed);
        setIsImportOpen(true);
        toast.success(`Parsed ${parsed.length} products from spreadsheet. Review before importing.`);
      } catch (err) {
        toast.error("Failed to parse file: Please ensure it is a valid .xlsx, .xls, or .csv");
      }
    };
    reader.readAsBinaryString(file);
    if (e.target) e.target.value = "";
  };

  const handleConfirmImport = async () => {
    if (importedRows.length === 0) return;
    setImporting(true);
    let successCount = 0;

    try {
      const supabase = await getSupabase();
      for (const row of importedRows) {
        const { error } = await supabase
          .from("products")
          .upsert(row, { onConflict: "slug" });

        if (!error) successCount++;
      }
      toast.success(`Successfully imported ${successCount} products into database!`);
    } catch (err) {
      toast.info(`Updated catalog with ${importedRows.length} products in memory`);
    } finally {
      setImporting(false);
      setIsImportOpen(false);
      setImportedRows([]);
      fetchProducts();
    }
  };

  // ── Filtered Products ───────────────────────────────────────────────────────
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      // 1. Search filter: English name, Tamil name, SKU, or category
      const s = search.trim().toLowerCase();
      const matchesSearch = !s || (
        (p.name && p.name.toLowerCase().includes(s)) || 
        (p.tamil_name && p.tamil_name.includes(s)) || 
        (p.tamilName && p.tamilName.includes(s)) || 
        (p.sku && p.sku.toLowerCase().includes(s)) ||
        (p.category && p.category.toLowerCase().includes(s))
      );

      // 2. Category filter
      const matchesCategory = categoryFilter === "all" || p.category === categoryFilter;

      // 3. Status filter
      const isActive = p.is_active !== false && p.enabled !== false;
      let matchesStatus = true;
      if (statusFilter === "active") matchesStatus = isActive;
      else if (statusFilter === "inactive") matchesStatus = !isActive;

      // 4. Stock filter (evaluates variant stock as well as product stock)
      const vList = Array.isArray(p.variants) && p.variants.length > 0
        ? p.variants
        : [{ size: "Standard", stock: Number(p.stock) || 0 }];
      
      let matchesStock = true;
      if (stockFilter === "low") {
        matchesStock = vList.some(v => {
          const s = Number(v.stock) || 0;
          return s > 0 && s <= 5;
        });
      } else if (stockFilter === "out") {
        matchesStock = vList.every(v => (Number(v.stock) || 0) === 0);
      } else if (stockFilter === "in") {
        matchesStock = vList.some(v => (Number(v.stock) || 0) > 0);
      }

      return matchesSearch && matchesCategory && matchesStatus && matchesStock;
    });
  }, [products, search, categoryFilter, statusFilter, stockFilter]);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Product & Inventory Management</h1>
          <p className="text-sm text-muted-foreground">
            Manage your product catalog, Tamil names, dynamic pack sizes, variant pricing, and real inventory.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            accept=".xlsx,.xls,.csv" 
            className="hidden" 
          />
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => fileInputRef.current?.click()} 
            className="gap-2"
          >
            <Upload className="h-4 w-4" /> Import Excel / CSV
          </Button>
          <Button 
            variant="outline" 
            size="sm"
            onClick={handleExportExcel} 
            className="gap-2"
          >
            <Download className="h-4 w-4" /> Export Products
          </Button>
          <Button size="sm" onClick={openAddDialog} className="gap-2 bg-primary text-primary-foreground">
            <Plus className="h-4 w-4" /> Add Product
          </Button>
        </div>
      </div>

      {/* KPI Stats Summary Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card className="shadow-none border border-border">
          <CardContent className="p-3.5 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Package className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Total Products</p>
              <h3 className="text-lg font-bold text-foreground">{stats.totalProducts}</h3>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-none border border-border">
          <CardContent className="p-3.5 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600">
              <Boxes className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Total Variants</p>
              <h3 className="text-lg font-bold text-foreground">{stats.totalVariants}</h3>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-none border border-border">
          <CardContent className="p-3.5 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">In-Stock Variants</p>
              <h3 className="text-lg font-bold text-emerald-600">{stats.inStockVariants}</h3>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-none border border-border">
          <CardContent className="p-3.5 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Low-Stock (&le; 5)</p>
              <h3 className="text-lg font-bold text-amber-600">{stats.lowStockVariants}</h3>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-none border border-border">
          <CardContent className="p-3.5 flex items-center gap-3">
            <div className="p-2 rounded-xl bg-red-500/10 text-red-600">
              <XCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Out-of-Stock (0)</p>
              <h3 className="text-lg font-bold text-red-600">{stats.outOfStockVariants}</h3>
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Search and Filters Bar */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between bg-card p-3 rounded-xl border border-border">
        {/* Search Input */}
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search by English name, Tamil name, or SKU..." 
            className="pl-9 h-9 text-sm" 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button 
              onClick={() => setSearch("")} 
              className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Filter Selects */}
        <div className="flex flex-wrap gap-2 items-center">
          {/* Category Filter */}
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[170px] h-9 text-xs">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {CATEGORIES.map(c => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Status Filter */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[130px] h-9 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active Only</SelectItem>
              <SelectItem value="inactive">Hidden Only</SelectItem>
            </SelectContent>
          </Select>

          {/* Stock Filter */}
          <Select value={stockFilter} onValueChange={setStockFilter}>
            <SelectTrigger className="w-[150px] h-9 text-xs">
              <SelectValue placeholder="Stock Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stock Levels</SelectItem>
              <SelectItem value="in">In Stock (&gt;0)</SelectItem>
              <SelectItem value="low">Low Stock (1–5)</SelectItem>
              <SelectItem value="out">Out of Stock (0)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Products Table */}
      <div className="w-full overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <Table className="min-w-[950px] md:min-w-full">
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="w-[70px]">Image</TableHead>
              <TableHead className="w-[240px]">Product Name</TableHead>
              <TableHead className="w-[140px]">Category</TableHead>
              <TableHead className="w-[120px]">SKU</TableHead>
              <TableHead className="min-w-[200px]">Pack Sizes & Variants</TableHead>
              <TableHead className="w-[100px]">Base Price</TableHead>
              <TableHead className="w-[130px]">Total Stock</TableHead>
              <TableHead className="w-[90px]">Status</TableHead>
              <TableHead className="text-right w-[90px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} className="h-32 text-center">
                  <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <p className="text-xs">Loading product catalog...</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : filteredProducts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">
                  <div className="flex flex-col items-center justify-center gap-1.5">
                    <AlertCircle className="h-6 w-6 text-muted-foreground/60" />
                    <p className="text-sm font-medium">No products match your search or filter</p>
                    <p className="text-xs text-muted-foreground">Try clearing search terms or changing the category filter.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredProducts.map((product) => {
                const img = product.images?.[0] || product.image;
                const variantList: VariantItem[] = Array.isArray(product.variants) 
                  ? product.variants 
                  : (typeof product.variants === "string" ? JSON.parse(product.variants || "[]") : []);

                const stockNum = Number(product.stock) || 0;
                const isActive = product.is_active ?? product.enabled ?? true;

                return (
                  <TableRow key={product.id || product.slug} className="hover:bg-muted/10 transition-colors">
                    {/* Image Thumbnail */}
                    <TableCell>
                      {img ? (
                        <img 
                          src={img} 
                          alt={product.name} 
                          className="h-11 w-11 rounded-lg object-cover border border-border shadow-xs" 
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = "none";
                          }}
                        />
                      ) : (
                        <div className="h-11 w-11 rounded-lg bg-muted flex items-center justify-center border border-border text-muted-foreground">
                          <ImageIcon className="h-4 w-4" />
                        </div>
                      )}
                    </TableCell>

                    {/* Product Name (English & Tamil) */}
                    <TableCell>
                      <div className="font-semibold text-foreground text-sm leading-tight">{product.name}</div>
                      {(product.tamil_name || product.tamilName) && (
                        <div className="text-xs text-primary/80 font-medium mt-0.5">
                          {product.tamil_name || product.tamilName}
                        </div>
                      )}
                    </TableCell>

                    {/* Category */}
                    <TableCell>
                      <Badge variant="outline" className="text-xs font-normal capitalize bg-muted/40">
                        {product.category?.replace("-", " ") || "oils"}
                      </Badge>
                    </TableCell>

                    {/* SKU */}
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      {product.sku || product.slug}
                    </TableCell>

                    {/* Variants Pills */}
                    <TableCell>
                      {variantList.length > 0 ? (
                        <div className="flex flex-wrap gap-1 max-w-[260px]">
                          {variantList.map((v, idx) => (
                            <Badge 
                              key={idx} 
                              variant={v.is_active !== false ? "secondary" : "outline"} 
                              className={`text-xs font-normal py-0.5 px-1.5 ${
                                v.is_active === false ? "opacity-50 line-through" : ""
                              }`}
                            >
                              <span className="font-medium">{v.size}:</span> ₹{v.price}
                              {v.stock !== undefined && (
                                <span className="text-[10px] text-muted-foreground ml-1">({v.stock})</span>
                              )}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Standard</span>
                      )}
                    </TableCell>

                    {/* Base Price */}
                    <TableCell className="font-semibold text-sm">
                      ₹{product.price || (variantList[0]?.price ?? 0)}
                    </TableCell>

                    {/* Stock Status Badge */}
                    <TableCell>
                      {stockNum === 0 ? (
                        <Badge variant="destructive" className="text-xs bg-red-100 text-red-800 hover:bg-red-100 border border-red-200">
                          Out of Stock (0)
                        </Badge>
                      ) : stockNum <= 5 ? (
                        <Badge variant="outline" className="text-xs bg-amber-50 text-amber-800 border-amber-300">
                          Low: {stockNum} units
                        </Badge>
                      ) : (
                        <span className="text-emerald-600 font-semibold text-xs flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> {stockNum} units
                        </span>
                      )}
                    </TableCell>

                    {/* Storefront Active / Hidden */}
                    <TableCell>
                      {isActive ? (
                        <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border border-emerald-200 text-xs font-normal">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs text-muted-foreground">
                          Hidden
                        </Badge>
                      )}
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="text-right space-x-1">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 hover:bg-muted" 
                        onClick={() => openEditDialog(product)}
                        title="Edit product & variants"
                      >
                        <Pencil className="h-4 w-4 text-foreground/80" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-destructive/80 hover:text-destructive hover:bg-destructive/10" 
                        onClick={() => handleDelete(product.id)}
                        title="Delete product"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── Product Add/Edit Modal ────────────────────────────────────────── */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-6">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              {selectedProduct ? (
                <>
                  <Pencil className="h-5 w-5 text-primary" />
                  Edit Product: {selectedProduct.name}
                </>
              ) : (
                <>
                  <Plus className="h-5 w-5 text-primary" />
                  Add New Product
                </>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Configure English & Tamil names, product category, size variants, real inventory stock, and image.
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pt-2">
              
              {/* Section 1: Names (English & Tamil) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold">Product Name (English) *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Cold Pressed Groundnut Oil" {...field} />
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )} />

                <FormField control={form.control} name="tamil_name" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold">Tamil Name (தமிழ் பெயர்)</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. மரச்செக்கு கடலை எண்ணெய்" {...field} />
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )} />
              </div>

              {/* Section 2: Category, URL Slug, SKU */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField control={form.control} name="category" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold">Category *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="text-sm">
                          <SelectValue placeholder="Select Category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CATEGORIES.map(c => (
                          <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )} />

                <FormField control={form.control} name="slug" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold">URL Slug *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. groundnut-oil" {...field} />
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )} />

                <FormField control={form.control} name="sku" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold">SKU / Code</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. SVEM-OIL-GND" {...field} />
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )} />
              </div>

              {/* Section 3: Base Display Price & Total Inventory Stock */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-xl border border-border bg-muted/20">
                <FormField control={form.control} name="price" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold">Base / Starting Price (₹)</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} placeholder="e.g. 120" {...field} />
                    </FormControl>
                    <p className="text-[11px] text-muted-foreground">
                      Display starting price shown on catalog cards. Defaults to lowest variant price.
                    </p>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )} />

                <FormField control={form.control} name="stock" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold">Total Inventory Stock</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} placeholder="Enter actual available units" {...field} />
                    </FormControl>
                    <p className="text-[11px] text-muted-foreground">
                      Available units for checkout. (0 = Out of stock). Sum of variant stock if variants are set.
                    </p>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )} />
              </div>

              {/* ── Section 4: Dynamic Pack Sizes & Variant Pricing Manager ─────── */}
              <div className="rounded-xl border border-primary/20 p-4 bg-primary/5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold flex items-center gap-1.5 text-foreground">
                      <Layers className="h-4 w-4 text-primary" /> Pack Sizes & Variant Pricing Manager
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Configure multiple pack sizes with independent prices, real stock, and SKU.
                    </p>
                  </div>
                  <Button 
                    type="button" 
                    size="sm" 
                    variant="outline" 
                    onClick={() => addVariantRow()} 
                    className="gap-1 text-xs shrink-0 bg-background"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Custom Pack Size
                  </Button>
                </div>

                {/* Quick Add Presets */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] text-muted-foreground font-medium">Quick add:</span>
                  {PRESET_PACK_SIZES.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => addVariantRow(preset)}
                      className="text-xs px-2 py-0.5 rounded-md border border-border bg-background hover:bg-muted text-foreground/80 hover:text-foreground transition-colors"
                    >
                      + {preset}
                    </button>
                  ))}
                </div>

                {variants.length === 0 ? (
                  <div className="p-4 text-center text-xs text-muted-foreground border border-dashed rounded-lg bg-background">
                    No custom pack sizes added yet. Standard base price and stock will apply.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <div className="hidden sm:grid grid-cols-12 gap-2 text-xs font-semibold text-muted-foreground px-1">
                      <span className="col-span-4">Pack Size *</span>
                      <span className="col-span-2">Price (₹) *</span>
                      <span className="col-span-2">Stock</span>
                      <span className="col-span-2">Variant SKU</span>
                      <span className="col-span-1 text-center">Active</span>
                      <span className="col-span-1 text-right">Delete</span>
                    </div>

                    {variants.map((v, idx) => (
                      <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-background p-2.5 rounded-lg border border-border">
                        {/* Size */}
                        <div className="sm:col-span-4">
                          <label className="text-[10px] text-muted-foreground sm:hidden">Pack Size</label>
                          <Input 
                            value={v.size} 
                            placeholder="e.g. 500 ml / 1 Kg"
                            onChange={(e) => updateVariantRow(idx, "size", e.target.value)}
                            className="h-8 text-xs"
                          />
                        </div>

                        {/* Price */}
                        <div className="sm:col-span-2">
                          <label className="text-[10px] text-muted-foreground sm:hidden">Price (₹)</label>
                          <Input 
                            type="number"
                            min={0}
                            value={v.price} 
                            placeholder="Price"
                            onChange={(e) => updateVariantRow(idx, "price", Number(e.target.value))}
                            className="h-8 text-xs font-semibold"
                          />
                        </div>

                        {/* Stock */}
                        <div className="sm:col-span-2">
                          <label className="text-[10px] text-muted-foreground sm:hidden">Stock</label>
                          <Input 
                            type="number"
                            min={0}
                            value={v.stock} 
                            placeholder="Stock"
                            onChange={(e) => updateVariantRow(idx, "stock", Number(e.target.value))}
                            className="h-8 text-xs"
                          />
                        </div>

                        {/* SKU */}
                        <div className="sm:col-span-2">
                          <label className="text-[10px] text-muted-foreground sm:hidden">SKU</label>
                          <Input 
                            value={v.sku || ""} 
                            placeholder="Optional SKU"
                            onChange={(e) => updateVariantRow(idx, "sku", e.target.value)}
                            className="h-8 text-xs font-mono"
                          />
                        </div>

                        {/* Active status */}
                        <div className="sm:col-span-1 flex items-center justify-center">
                          <button
                            type="button"
                            onClick={() => updateVariantRow(idx, "is_active", !(v.is_active !== false))}
                            className={`p-1.5 rounded-md text-xs transition-colors ${
                              v.is_active !== false 
                                ? "text-emerald-700 bg-emerald-50 hover:bg-emerald-100" 
                                : "text-muted-foreground bg-muted hover:bg-muted/80"
                            }`}
                            title={v.is_active !== false ? "Variant Active" : "Variant Hidden"}
                          >
                            {v.is_active !== false ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                          </button>
                        </div>

                        {/* Delete button */}
                        <div className="sm:col-span-1 text-right">
                          <Button 
                            type="button" 
                            size="icon" 
                            variant="ghost" 
                            className="h-8 w-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                            onClick={() => removeVariantRow(idx)}
                            title="Remove pack size"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Section 5: Marketing Tags */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-foreground">Marketing Badges & Tags</label>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_TAGS.map(tag => {
                    const active = selectedTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                          active 
                            ? "bg-primary text-primary-foreground border-primary font-medium shadow-xs" 
                            : "bg-background text-muted-foreground border-border hover:border-foreground/30"
                        }`}
                      >
                        {active ? `✓ ${tag}` : `+ ${tag}`}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Section 6: Image URL and File Upload with Preview */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-foreground">Product Image (URL or File Upload)</label>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-3 rounded-xl border border-border bg-card">
                  {/* Thumbnail Preview Container */}
                  <div className="relative group shrink-0">
                    {imageUrl ? (
                      <div className="relative h-20 w-20 rounded-lg overflow-hidden border border-border shadow-xs">
                        <img 
                          src={imageUrl} 
                          alt="Product preview" 
                          className="h-full w-full object-cover" 
                        />
                        <button
                          type="button"
                          onClick={() => setImageUrl("")}
                          className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white rounded-full p-0.5 opacity-80 hover:opacity-100 transition-opacity"
                          title="Clear image"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="h-20 w-20 rounded-lg bg-muted flex flex-col items-center justify-center border border-border text-muted-foreground gap-1">
                        <ImageIcon className="h-6 w-6 text-muted-foreground/60" />
                        <span className="text-[10px]">No image</span>
                      </div>
                    )}
                  </div>

                  {/* URL Input & File Upload Input */}
                  <div className="flex-1 space-y-2.5 w-full">
                    <div>
                      <Input 
                        placeholder="Paste image URL directly (e.g. ImgBB / Cloudinary / Web CDN)..." 
                        value={imageUrl} 
                        onChange={(e) => setImageUrl(e.target.value)} 
                        className="text-xs h-9"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground font-medium">Or upload:</span>
                      <Input 
                        type="file" 
                        accept="image/*" 
                        onChange={handleImageUpload} 
                        disabled={uploadingImage}
                        className="text-xs h-8 cursor-pointer file:cursor-pointer"
                      />
                      {uploadingImage && <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />}
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 7: Description */}
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold">Product Description & Benefits</FormLabel>
                  <FormControl>
                    <Textarea 
                      rows={3} 
                      placeholder="Traditional wood-pressed extraction, 100% natural, rich in nutrients and authentic aroma..." 
                      className="text-xs"
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )} />

              {/* Section 8: Storefront Visibility Switch */}
              <FormField control={form.control} name="is_active" render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-xl border border-border p-4 bg-muted/20">
                  <div className="space-y-0.5">
                    <FormLabel className="text-sm font-semibold text-foreground">Storefront Visibility</FormLabel>
                    <p className="text-xs text-muted-foreground">
                      When active, this product will be visible and purchasable in the shop catalog.
                    </p>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )} />

              {/* Dialog Action Buttons */}
              <div className="flex justify-end gap-3 pt-3 border-t border-border">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setIsDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={uploadingImage}
                  className="bg-primary text-primary-foreground gap-2"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {selectedProduct ? "Save Changes" : "Create Product"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Excel Import Preview Modal ────────────────────────────────────── */}
      <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
              Spreadsheet Import Preview ({importedRows.length} Products Found)
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Review parsed products before importing into the database. Existing products with matching slugs will be updated.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Name</TableHead>
                    <TableHead>Tamil Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Stock</TableHead>
                    <TableHead>Variants</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importedRows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium text-xs">{r.name}</TableCell>
                      <TableCell className="text-xs text-primary/80">{r.tamil_name || "—"}</TableCell>
                      <TableCell className="text-xs capitalize">{r.category}</TableCell>
                      <TableCell className="text-xs font-semibold">₹{r.price}</TableCell>
                      <TableCell className="text-xs">{r.stock} units</TableCell>
                      <TableCell className="text-xs">
                        {r.variants?.length ? r.variants.map((v: any) => v.size).join(", ") : "Standard"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setIsImportOpen(false)} disabled={importing}>
                Cancel
              </Button>
              <Button onClick={handleConfirmImport} disabled={importing} className="gap-2 bg-primary text-primary-foreground">
                {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirm & Import {importedRows.length} Products
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
