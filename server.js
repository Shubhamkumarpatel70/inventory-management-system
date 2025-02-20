const express = require("express");
const fs = require("fs").promises;
const cors = require("cors");
const path = require("path");
const { exec } = require("child_process");
const { body, param, validationResult } = require("express-validator");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 4000;
const DATA_FILE = path.join(__dirname, "products.json");
const BEEP_SOUND_PATH = path.join(__dirname, "beep.wav");

// WebSocket setup
const wss = new WebSocket.Server({ noServer: true });
const clients = new Set();

// Utility: Load products from file
const loadProducts = async () => {
    try {
        await fs.access(DATA_FILE).catch(() => fs.writeFile(DATA_FILE, JSON.stringify([]), "utf8"));
        const data = await fs.readFile(DATA_FILE, "utf8");
        return data.trim() ? JSON.parse(data) : [];
    } catch (error) {
        console.error("❌ Error loading products:", error);
        return [];
    }
};

// Utility: Save products to file
const saveProducts = async (products) => {
    try {
        await fs.writeFile(DATA_FILE, JSON.stringify(products, null, 2), "utf8");
        console.log("✅ Products saved successfully");
    } catch (error) {
        console.error("❌ Error saving products:", error);
    }
};

// Utility: Send WebSocket updates
const broadcast = (type, data) => {
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type, data }));
        }
    });
};

// WebSocket connection
wss.on("connection", (ws) => {
    clients.add(ws);

    ws.on("message", (message) => console.log("📩 Message received:", message));

    ws.on("close", () => {
        clients.delete(ws);
        console.log("🔴 WebSocket disconnected");
    });
});

app.use(express.static(path.join(__dirname, "frontend")));
app.use(cors());
app.use(express.json());

// API Routes

// Get all products
app.get("/products", async (req, res) => {
    try {
        res.json(await loadProducts());
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch products" });
    }
});

// Add or update product
app.post("/add-product",
    [
        body("id").notEmpty().withMessage("Product ID is required"),
        body("name").notEmpty().withMessage("Product name is required"),
        body("stock").isInt({ min: 0 }).withMessage("Stock must be a non-negative integer"),
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        try {
            let { id, name, stock } = req.body;
            let products = await loadProducts();
            let product = products.find((p) => p.id === id);

            if (product) {
                product.stock += stock;
            } else {
                products.push({ id, name, stock });
            }

            await saveProducts(products);
            broadcast("product-updated", products);

            res.json({ message: "✅ Product saved successfully!", products });
        } catch (error) {
            res.status(500).json({ error: "Internal server error while saving product" });
        }
    }
);

// Update product stock
app.put("/update-product/:id",
    [
        param("id").notEmpty().withMessage("Product ID is required"),
        body("stock").isInt({ min: 0 }).withMessage("Stock must be a non-negative integer"),
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        try {
            let { id } = req.params;
            let { stock } = req.body;
            let products = await loadProducts();
            let product = products.find((p) => p.id === id);

            if (!product) return res.status(404).json({ error: "Product not found" });

            product.stock = stock;
            await saveProducts(products);
            broadcast("product-updated", products);

            res.json({ message: "✅ Product updated successfully!", products });
        } catch (error) {
            res.status(500).json({ error: "Internal server error while updating product" });
        }
    }
);

// Delete product
app.delete("/delete-product/:id",
    param("id").notEmpty().withMessage("Product ID is required"),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        try {
            let productId = req.params.id.trim();
            let products = await loadProducts();
            let updatedProducts = products.filter((p) => p.id !== productId);

            if (products.length === updatedProducts.length) {
                return res.status(404).json({ error: "Product not found" });
            }

            await saveProducts(updatedProducts);
            broadcast("product-deleted", productId);

            res.json({ message: "✅ Product deleted successfully!" });
        } catch (error) {
            res.status(500).json({ error: "Internal server error while deleting product" });
        }
    }
);

// Update product details (including name & stock)
app.put("/edit-product/:id",
    [
        param("id").notEmpty().withMessage("Product ID is required"),
        body("name").notEmpty().withMessage("Product name is required"),
        body("stock").isInt({ min: 0 }).withMessage("Stock must be a non-negative integer"),
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        try {
            let { id } = req.params;
            let { name, stock } = req.body;
            let products = await loadProducts();
            let productIndex = products.findIndex((p) => p.id === id);

            if (productIndex === -1) return res.status(404).json({ error: "Product not found" });

            // Update product details
            products[productIndex].name = name;
            products[productIndex].stock = stock;

            await saveProducts(products);
            broadcast("product-updated", products[productIndex]);

            res.json({ message: "✅ Product updated successfully!", product: products[productIndex] });
        } catch (error) {
            res.status(500).json({ error: "Internal server error while updating product" });
        }
    }
);

// Delete product from JSON
app.delete("/delete-product/:id",
    param("id").notEmpty().withMessage("Product ID is required"),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        try {
            let productId = req.params.id.trim();
            let products = await loadProducts();
            let updatedProducts = products.filter((p) => p.id !== productId);

            if (products.length === updatedProducts.length) {
                return res.status(404).json({ error: "Product not found" });
            }

            await saveProducts(updatedProducts);
            broadcast("product-deleted", productId);

            res.json({ message: "✅ Product deleted successfully!" });
        } catch (error) {
            res.status(500).json({ error: "Internal server error while deleting product" });
        }
    }
);

// Play beep sound
app.post("/play-beep", async (req, res) => {
    try {
        await fs.access(BEEP_SOUND_PATH);

        let command;
        switch (process.platform) {
            case "win32":
                command = `powershell -c (New-Object Media.SoundPlayer '${BEEP_SOUND_PATH}').PlaySync();`;
                break;
            case "darwin":
                command = `afplay "${BEEP_SOUND_PATH}"`;
                break;
            default:
                command = `aplay "${BEEP_SOUND_PATH}" || paplay "${BEEP_SOUND_PATH}"`;
        }

        exec(command, (err) => {
            if (err) {
                console.error("🔇 Beep sound error:", err.message);
                return res.status(500).json({ error: "Error playing beep sound" });
            }
            res.json({ message: "🔊 Beep sound played!" });
        });

    } catch (error) {
        console.error("❌ Beep sound file not found:", error.message);
        res.status(404).json({ error: "Beep sound file not found" });
    }
});

// Save scan (increments stock if product exists)
app.post("/save-scan",
    [
        body("id").notEmpty().withMessage("Product ID is required"),
        body("name").optional().notEmpty().withMessage("Product name cannot be empty"),
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        try {
            let { id, name } = req.body;
            let products = await loadProducts();
            let productIndex = products.findIndex((p) => p.id === id);

            if (productIndex !== -1) {
                // Product exists, increase stock by 1
                products[productIndex].stock += 1;
            } else {
                // Product does not exist, ensure name is provided
                if (!name) return res.status(400).json({ error: "Product name is required for a new entry" });

                // Add new product with stock = 1
                products.push({ id, name, stock: 1 });
            }

            await saveProducts(products);
            broadcast("scan-saved", products[productIndex] || { id, name, stock: 1 });

            res.json({ message: "✅ Scan saved", products });
        } catch (error) {
            res.status(500).json({ error: "Internal server error while saving scan" });
        }
    }
);


// Start Server with WebSocket Support
const server = app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

server.on("upgrade", (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
});
