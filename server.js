require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// =======================
// RATE LIMITER
// =======================
const requestCounts = {};

const rateLimiter = (req, res, next) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  if (!requestCounts[ip]) requestCounts[ip] = [];
  requestCounts[ip] = requestCounts[ip].filter((t) => now - t < 60000);
  if (requestCounts[ip].length >= 20) {
    return res.status(429).json({ error: "Trop de requêtes. Réessayez dans une minute." });
  }
  requestCounts[ip].push(now);
  return next();
};

// =======================
// MULTER CONFIG
// =======================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error("Image invalide."));
  },
});

// =======================
// PRODUCT SCHEMA
// =======================
const productSchema = new mongoose.Schema({
  name:      { type: String, required: true, trim: true, maxlength: 100 },
  price:     { type: Number, required: true, min: 0 },
  oldPrice:  { type: Number, min: 0 },
  image:     String,
  category:  { type: String, enum: ["set", "pantalon", "robe", "pull", "veste"], required: true },
  isSoldOut: { type: Boolean, default: false },
  sizes:     [{ size: String, available: Boolean }],
}, { timestamps: true });

const Product = mongoose.model("Product", productSchema);

// =======================
// ORDER ITEM SCHEMA
// =======================
const orderItemSchema = new mongoose.Schema({
  productId:    { type: String, required: true },
  productName:  { type: String, required: true },
  productImage: { type: String, default: "" },
  price:        { type: Number, required: true },
  quantity:     { type: Number, required: true, min: 1 },
  size:         { type: String, required: true },
  subtotal:     { type: Number, required: true },
});

// =======================
// ORDER SCHEMA
// =======================
const orderSchema = new mongoose.Schema({
  ref:      { type: String },
  items:    { type: [orderItemSchema], required: true },
  subtotal: { type: Number, required: true },
  delivery: { type: Number, default: 8 },
  total:    { type: Number, required: true },
  customer: {
    nom:       { type: String, required: true, trim: true, maxlength: 80 },
    telephone: { type: String, required: true, trim: true },
    ville:     { type: String, required: true, trim: true, maxlength: 60 },
    adresse:   { type: String, required: true, trim: true, maxlength: 150 },
  },
  status: {
    type:    String,
    enum:    ["En attente", "Confirmée", "Livrée"],
    default: "En attente",
  },
}, { timestamps: true });

const Order = mongoose.model("Order", orderSchema);

// =======================
// ADMIN AUTH ✅ only once, using .env
// =======================
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_TOKEN    = process.env.ADMIN_TOKEN;

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true, token: ADMIN_TOKEN });
  } else {
    res.status(401).json({ error: "Mot de passe incorrect." });
  }
});

app.get("/api/admin/verify", (req, res) => {
  const token = req.headers["x-admin-token"];
  if (token === ADMIN_TOKEN) {
    res.json({ valid: true });
  } else {
    res.status(401).json({ valid: false });
  }
});

// =======================
// PRODUCT ROUTES
// =======================
app.post("/api/products", upload.single("image"), async (req, res) => {
  try {
    const newProduct = new Product({
      name:      req.body.name?.trim(),
      price:     Number(req.body.price),
      oldPrice:  req.body.oldPrice ? Number(req.body.oldPrice) : undefined,
      category:  req.body.category,
      isSoldOut: req.body.isSoldOut === "true",
      sizes:     req.body.sizes ? JSON.parse(req.body.sizes) : [],
      image:     req.file ? `uploads/${req.file.filename}` : "",
    });
    await newProduct.save();
    res.status(201).json(newProduct);
  } catch (err) {
    console.error("CREATE PRODUCT ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/products/:id", upload.single("image"), async (req, res) => {
  try {
    const updateData = {
      name:      req.body.name?.trim(),
      price:     Number(req.body.price),
      oldPrice:  req.body.oldPrice ? Number(req.body.oldPrice) : undefined,
      category:  req.body.category,
      isSoldOut: req.body.isSoldOut === "true",
    };
    if (req.body.sizes) updateData.sizes = JSON.parse(req.body.sizes);
    if (req.file) updateData.image = `uploads/${req.file.filename}`;

    const updated = await Product.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!updated) return res.status(404).json({ error: "Produit introuvable." });
    res.json(updated);
  } catch (err) {
    console.error("UPDATE PRODUCT ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/products", async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/products/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "Produit introuvable." });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/products/:id", async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ message: "Produit supprimé." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =======================
// ORDER ROUTES
// =======================
app.post("/api/orders", rateLimiter, async (req, res) => {
  try {
    const { items, customer } = req.body;

    const { nom, telephone, ville, adresse } = customer || {};
    if (!nom?.trim() || !telephone?.trim() || !ville?.trim() || !adresse?.trim()) {
      return res.status(400).json({ error: "Tous les champs client sont requis." });
    }
    if (!/^\d{8,15}$/.test(telephone.trim())) {
      return res.status(400).json({ error: "Numéro de téléphone invalide." });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Le panier est vide." });
    }

    const validatedItems = [];
    for (const item of items) {
      if (!item.productId || !item.size || !item.quantity) {
        return res.status(400).json({ error: "Données article invalides." });
      }
      const product = await Product.findById(item.productId);
      if (!product) return res.status(404).json({ error: "Produit introuvable." });
      if (product.isSoldOut) return res.status(400).json({ error: `"${product.name}" est épuisé.` });
      if (item.size !== "N/A") {
        const sizeEntry = product.sizes.find((s) => s.size === item.size);
        if (!sizeEntry || !sizeEntry.available) {
          return res.status(400).json({ error: `Taille ${item.size} non disponible pour "${product.name}".` });
        }
      }
      const qty = Math.max(1, Number(item.quantity) || 1);
      validatedItems.push({
        productId:    product._id.toString(),
        productName:  product.name,
        productImage: product.image || "",
        price:        product.price,
        quantity:     qty,
        size:         item.size,
        subtotal:     product.price * qty,
      });
    }

    const subtotal = validatedItems.reduce((sum, i) => sum + i.subtotal, 0);
    const delivery = 8;
    const total = subtotal + delivery;

    const order = new Order({
      ref: "XOXO-" + Date.now(),
      items: validatedItems,
      subtotal,
      delivery,
      total,
      customer: {
        nom:       nom.trim(),
        telephone: telephone.trim(),
        ville:     ville.trim(),
        adresse:   adresse.trim(),
      },
    });

    await order.save();
    console.log("✅ New order saved:", order.ref);
    res.status(201).json({ message: "Commande reçue ✅", order });

  } catch (err) {
    console.error("ORDER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/orders/stats", async (req, res) => {
  try {
    const orders = await Order.find();
    const totalRevenue = orders.filter((o) => o.status === "Livrée").reduce((sum, o) => sum + o.total, 0);
    const productCount = {};
    orders.forEach((o) => {
      (o.items || []).forEach((i) => {
        productCount[i.productName] = (productCount[i.productName] || 0) + i.quantity;
      });
    });
    const bestSellers = Object.entries(productCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, qty]) => ({ name, qty }));

    res.json({
      totalRevenue,
      totalOrders: orders.length,
      pending:   orders.filter((o) => o.status === "En attente").length,
      confirmed: orders.filter((o) => o.status === "Confirmée").length,
      delivered: orders.filter((o) => o.status === "Livrée").length,
      bestSellers,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/orders", async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const orders = await Order.find(filter).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/orders/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ["En attente", "Confirmée", "Livrée"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: "Statut invalide." });
    }
    const updated = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!updated) return res.status(404).json({ error: "Commande introuvable." });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/orders/:id", async (req, res) => {
  try {
    await Order.findByIdAndDelete(req.params.id);
    res.json({ message: "Commande supprimée." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =======================
// DB CONNECTION
// =======================
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ DB Connected");
    app.listen(process.env.PORT || 5000, () =>
      console.log(`🚀 Server running on ${process.env.PORT || 5000}`)
    );
  })
  .catch((err) => console.log(err));