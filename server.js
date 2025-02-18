const express = require("express");
const fs = require("fs").promises;
const cors = require("cors");
const path = require("path");
const { exec } = require("child_process");
const { body, param, validationResult } = require("express-validator");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 10000; // Use Render's assigned port
const DATA_FILE = path.join(__dirname, "products.json");
const BEEP_SOUND_PATH = path.join(__dirname, "frontend", "audio", "beep.mp3");

// WebSocket setup
const wss = new WebSocket.Server({ noServer: true });
let clients = [];

// Function to load products safely
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

// Function to save products safely
const saveProducts = async (products) => {
    try {
        await fs.writeFile(DATA_FILE, JSON.stringify(products, null, 2), "utf8");
        console.log("✅ Products saved successfully");
    } catch (error) {
        console.error("❌ Error saving products:", error);
    }
};


// WebSocket connection
wss.on("connection", (ws) => {
    clients.push(ws);

    ws.on("message", (message) => {
        console.log("Message received:", message);
    });

    ws.on("close", () => {
        clients = clients.filter(client => client !== ws);
    });
});

app.use(express.static(path.join(__dirname, "frontend")));
app.use(cors());
app.use(express.json());

// Get all products
app.get("/products", async (req, res) => {
    try {
        const products = await loadProducts();
        res.json(products);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch products" });
    }
});

// Add or update product
app.post(
    "/add-product",
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
            clients.forEach(client => client.send(JSON.stringify({ type: 'product-updated', products })));

            res.json({ message: "Product saved successfully!", products });
        } catch (error) {
            res.status(500).json({ error: "Internal server error while saving product" });
        }
    }
);

// Update product
app.put(
    "/update-product/:id",
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
            let productIndex = products.findIndex((p) => p.id === id);

            if (productIndex === -1) return res.status(404).json({ error: "Product not found" });

            products[productIndex].stock = stock;
            await saveProducts(products);
            clients.forEach(client => client.send(JSON.stringify({ type: 'product-updated', products })));

            res.json({ message: "Product updated successfully!", products });
        } catch (error) {
            res.status(500).json({ error: "Internal server error while updating product" });
        }
    }
);

// Delete product
app.delete(
    "/delete-product/:id",
    param("id").notEmpty().withMessage("Product ID is required"),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        try {
            let productId = req.params.id.trim();
            let products = (await loadProducts()).filter((p) => p.id !== productId);

            await saveProducts(products);
            clients.forEach(client => client.send(JSON.stringify({ type: 'product-deleted', productId })));

            res.json({ message: "Product deleted successfully!" });
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
        if (process.platform === "win32") {
            command = `start wmplayer /play /close "${BEEP_SOUND_PATH}"`;
        } else if (process.platform === "darwin") {
            command = `afplay "${BEEP_SOUND_PATH}"`;
        } else {
            command = `aplay "${BEEP_SOUND_PATH}" || paplay "${BEEP_SOUND_PATH}"`;
        }

        exec(command, (err, stdout, stderr) => {
            if (err) {
                console.error("🔇 Beep sound error:", stderr);
                return res.status(500).json({ error: "Error playing beep sound" });
            }
            res.json({ message: "Beep sound played!" });
        });
    } catch (error) {
        res.status(404).json({ error: "Beep sound file not found" });
    }
});

// Save scan
app.post(
    "/save-scan",
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
            let product = products.find((p) => p.id === id);

            if (product) {
                product.stock += 1;
            } else {
                if (!name) return res.status(400).json({ error: "Product name is required for a new entry" });
                product = { id, name, stock: 1 };
                products.push(product);
            }

            await saveProducts(products);
            clients.forEach(client => client.send(JSON.stringify({ type: 'scan-saved', product })));

            res.json({ message: "Scan saved", product });
        } catch (error) {
            res.status(500).json({ error: "Internal server error while saving scan" });
        }
    }
);

// Start Server with WebSocket Support
const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});

server.on("upgrade", (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
    });
});
