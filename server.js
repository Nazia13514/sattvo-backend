const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { google } = require("googleapis");
const nodemailer = require("nodemailer");

dotenv.config();

// ✅ CREATE APP FIRST (VERY IMPORTANT)
const app = express();
const PORT = process.env.PORT || 3000;

// ✅ MIDDLEWARE
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (origin.endsWith('netlify.app')) {
      return callback(null, true);
    }
    return callback(new Error('CORS not allowed'), false);
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

// Product Catalog for Backend Price Validation
// Replace these with your exact prices
const catalog = {
  "Almond Sattvo 500g": 650,
  "Walnut Sattvo 500g": 650,
  "Cashew Sattvo 500g": 650,
  "Pistachio Sattvo 500g": 650,
  "Almond Sattvo 250g": 350,
  "Walnut Sattvo 250g": 350,
  "Cashew Sattvo 250g": 350,
  "Pistachio Sattvo 250g": 350
};

// ==========================================
// SERVE STATIC FRONTEND
// ==========================================
app.use(express.static('./'));

// ==========================================
// GOOGLE SHEETS HELPER
// ==========================================
async function saveToGoogleSheets(orderData) {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    console.log("Google Sheets credentials missing. Skipping save.");
    return;
  }

  try {
    // Replace literal \n with actual newlines securely
    const privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

    const auth = new google.auth.JWT(
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      null,
      privateKey,
      ["https://www.googleapis.com/auth/spreadsheets"]
    );

    const sheets = google.sheets({ version: "v4", auth });

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: "Sheet1!A1", // Make sure Sheet1 is correct
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          new Date().toLocaleString(),
          orderData.customer.name,
          orderData.customer.phone,
          orderData.customer.email,
          orderData.customer.address,
          orderData.cart.map(i => `${i.name} × ${i.qty}`).join(", "),
          orderData.totalAmount
        ]]
      }
    });
    console.log(`[SUCCESS] Order saved to Google Sheets successfully`);
  } catch (error) {
    console.error(`[FAILURE] Google Sheets Error:`, error);
  }
}

// ==========================================
// NODEMAILER HELPER
// ==========================================
async function sendOrderEmail(orderData) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log("Email credentials missing. Skipping email.");
    return;
  }

  try {
    let transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const cartHtml = orderData.cart.map(item => {
      const price = catalog[item.name] || 0;
      return `
        <tr>
          <td style="padding:8px; border:1px solid #ddd;">${item.name}</td>
          <td style="padding:8px; border:1px solid #ddd; text-align:center;">${item.qty}</td>
          <td style="padding:8px; border:1px solid #ddd; text-align:right;">Rs. ${price * item.qty}</td>
        </tr>
      `;
    }).join("");

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER, // Send to store admin
      subject: "New Order Received - Sattvo",
      html: `
        <h2>New Order Confirmed</h2>
        <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
        <hr>
        <h3>Customer Details</h3>
        <p><strong>Name:</strong> ${orderData.customer.name}</p>
        <p><strong>Phone:</strong> ${orderData.customer.phone}</p>
        <p><strong>Email:</strong> ${orderData.customer.email}</p>
        <p><strong>Address:</strong> ${orderData.customer.address}</p>
        <hr>
        <h3>Order Items</h3>
        <table style="border-collapse: collapse; width: 100%; max-width: 600px;">
          <thead>
            <tr style="background:#fdf5e6;">
              <th style="padding:8px; border:1px solid #ddd; text-align:left;">Product</th>
              <th style="padding:8px; border:1px solid #ddd;">Quantity</th>
              <th style="padding:8px; border:1px solid #ddd; text-align:right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${cartHtml}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2" style="padding:8px; border:1px solid #ddd; text-align:right; font-weight:bold;">Total Amount:</td>
              <td style="padding:8px; border:1px solid #ddd; text-align:right; font-weight:bold;">Rs. ${orderData.totalAmount}</td>
            </tr>
          </tfoot>
        </table>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`[SUCCESS] Email sent successfully`);
  } catch (error) {
    console.error(`[FAILURE] Nodemailer Error:`, error);
  }
}

// ==========================================
// SUBMIT ORDER
// ==========================================
app.post('/api/submit-order', async (req, res) => {
  try {
    const { customer, cart, totalAmount } = req.body;
    console.log(`[INFO] Order submission received for customer: ${customer.name}`);

    if (!cart || cart.length === 0) {
      return res.status(400).json({ error: "Cart is empty" });
    }

    // TASK 1: ADD COMPLETE DEBUG LOGGING
    console.log("====== ORDER VALIDATION LOG ======");
    console.log("Received Customer:", JSON.stringify(customer, null, 2));
    console.log("Received Cart:", JSON.stringify(cart, null, 2));
    console.log("Received Total:", totalAmount);
    console.log("Catalog Used:", JSON.stringify(catalog, null, 2));

    // Backend price validation
    let calculatedAmount = 0;
    cart.forEach(item => {
      const itemPrice = catalog[item.name];
      if (!itemPrice) {
        throw new Error(`Product "${item.name}" not found in catalog.`);
      }
      
      // TASK 5: CHECK CART PAYLOAD
      console.log(`Product: ${item.name}`);
      console.log(`Quantity: ${item.qty}`);
      console.log(`Frontend Price: ${item.price} (if sent)`);
      console.log(`Backend Price: ${itemPrice}`);
      
      calculatedAmount += itemPrice * item.qty;
    });

    console.log("Calculated Total (Expected):", calculatedAmount);
    
    // TASK 6: VERIFY TOTAL CALCULATION
    console.log(`Comparing Frontend Total: ${totalAmount} vs Backend Calculated Total: ${calculatedAmount}`);

    if (calculatedAmount !== totalAmount) {
      console.log("Validation Result: FAILED (Price Mismatch)");
      // TASK 2: RETURN DETAILED ERROR INFORMATION
      return res.status(400).json({ 
        error: "Price mismatch",
        expectedTotal: calculatedAmount,
        receivedTotal: totalAmount,
        cart: cart
      });
    }
    
    console.log("Validation Result: PASSED");
    console.log("==================================");

    const orderData = {
      customer: customer,
      cart: cart,
      totalAmount: calculatedAmount
    };

    // Process asynchronously (do not block the user response)
    saveToGoogleSheets(orderData);
    sendOrderEmail(orderData);

    res.json({ success: true, message: "Order processed successfully." });

  } catch (error) {
    console.error("Submit Order Error:", error);
    res.status(500).json({ error: error.message || "Failed to submit order" });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
