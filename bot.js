require('dotenv').config();

// Robust import handling for node-telegram-bot-api
const TelegramBotModule = require('node-telegram-bot-api');
const TelegramBot = TelegramBotModule.default || TelegramBotModule;

const Database = require('better-sqlite3');

// Read token from .env or place your fallback string here
const TOKEN ='8804352878:AAEX0awEjTpcjULNgzdYuMGmGrpY_-UfZqo';

if (!TOKEN || TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
    console.error('❌ Error: Please set a valid TELEGRAM_BOT_TOKEN in your .env file!');
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// --- 1. DATABASE SETUP (SQLite) ---
const db = new Database('./borderline_cafe.db');

// Create required tables synchronously
db.exec(`
    CREATE TABLE IF NOT EXISTS menu_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        price REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
        user_id INTEGER PRIMARY KEY,
        selected_item_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        user_name TEXT,
        item_id INTEGER NOT NULL,
        item_name TEXT NOT NULL,
        category TEXT NOT NULL,
        price REAL NOT NULL,
        payment_method TEXT NOT NULL,
        order_date TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// Seed Borderline Cafe Menu if empty
const countRow = db.prepare(`SELECT COUNT(*) as count FROM menu_items`).get();

if (countRow.count === 0) {
    const insertStmt = db.prepare(`INSERT INTO menu_items (name, category, price) VALUES (?, ?, ?)`);
    const menu = [
        // Pizza
        ['Super Deluxe Pizza', 'Pizza', 1100], ['Special Borderline Pizza', 'Pizza', 900],
        ['Chicken Pizza', 'Pizza', 900], ['Meat Lover’s Pizza', 'Pizza', 800],
        ['Tuna Pizza', 'Pizza', 850], ['Tuna Fasting Pizza', 'Pizza', 800],
        ['Vegetable Pizza', 'Pizza', 650], ['Special Vegetable Pizza', 'Pizza', 800],
        ['Margarita Pizza', 'Pizza', 700],
        // Burger
        ['Chicken Burger', 'Burger', 800], ['Special Chicken Burger', 'Burger', 950],
        ['Special Beef Burger', 'Burger', 950], ['Cheese Burger', 'Burger', 700],
        ['Egg Burger', 'Burger', 760], ['Normal Burger', 'Burger', 600],
        ['Great Smash Burger', 'Burger', 1400], ['Mini Special Burger', 'Burger', 800],
        ['Jambo Special Burger', 'Burger', 1250],
        // Burrito
        ['Chicken Burrito', 'Burrito', 800], ['Beef Burrito', 'Burrito', 750],
        ['Tuna Burrito', 'Burrito', 750], ['Vegetable Burrito', 'Burrito', 550],
        ['Special Borderline Burrito', 'Burrito', 950],
        // Lunch
        ['Chicken Goulash', 'Lunch', 800], ['Grilled Chicken', 'Lunch', 900],
        // Sandwich
        ['Egg Sandwich', 'Sandwich', 550], ['Tuna Club Sandwich', 'Sandwich', 550],
        ['Tuna Sandwich', 'Sandwich', 500], ['Beef Sandwich', 'Sandwich', 600],
        ['Chicken Club Sandwich', 'Sandwich', 700], ['Felafel Sandwich', 'Sandwich', 450],
        ['Ham and Cheese', 'Sandwich', 700],
        // Drinks
        ['Normal Juice', 'Drinks', 200], ['Mix Juice', 'Drinks', 250],
        ['Softdrinks', 'Drinks', 60], ['Coffee', 'Drinks', 40], ['Water', 'Drinks', 60]
    ];

    const insertMany = db.transaction((items) => {
        for (const item of items) insertStmt.run(item);
    });
    insertMany(menu);
    console.log('✅ Menu items seeded successfully.');
}

console.log('🚀 Borderline Cafe Telegram Bot is live and listening!');

// --- 2. COMMAND HANDLERS ---

// /start or /menu command
bot.onText(/\/(start|menu)/, (msg) => {
    const chatId = msg.chat.id;

    const items = db.prepare(`SELECT * FROM menu_items ORDER BY category, id`).all();

    const inlineKeyboard = items.map(item => [
        {
            text: `${item.name} — ${item.price} ETB`,
            callback_data: `item_${item.id}`
        }
    ]);

    bot.sendMessage(chatId, '🍕 *Welcome to Borderline Cafe!* 🍔\n\nTap an item below to place an order:', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: inlineKeyboard }
    });
});

// /report command for Cashier / Admin
bot.onText(/\/report/, (msg) => {
    const chatId = msg.chat.id;
    sendDailyReport(chatId);
});

// --- 3. BUTTON CALLBACK HANDLER ---
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const userName = query.from.first_name || 'Customer';
    const data = query.data;

    // Step 1: User Selected a Menu Item
    if (data.startsWith('item_')) {
        const itemId = parseInt(data.split('_')[1], 10);
        const item = db.prepare(`SELECT * FROM menu_items WHERE id = ?`).get(itemId);

        if (item) {
            db.prepare(`INSERT OR REPLACE INTO sessions (user_id, selected_item_id) VALUES (?, ?)`).run(userId, item.id);

            const paymentKeyboard = [
                [{ text: '💵 Cash', callback_data: 'pay_Cash' }],
                [{ text: '📱 Telebirr', callback_data: 'pay_Telebirr' }],
                [{ text: '💳 eBirr', callback_data: 'pay_eBirr' }],
                [{ text: '🏦 Account Transfer', callback_data: 'pay_Account Transfer' }]
            ];

            bot.sendMessage(chatId, `Selected: *${item.name}* (${item.price} ETB)\n\nSelect payment method:`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: paymentKeyboard }
            });
        }
    }

    // Step 2: User Selected a Payment Method
    if (data.startsWith('pay_')) {
        const paymentMethod = data.split('_')[1];
        const session = db.prepare(`SELECT selected_item_id FROM sessions WHERE user_id = ?`).get(userId);

        if (session && session.selected_item_id) {
            const item = db.prepare(`SELECT * FROM menu_items WHERE id = ?`).get(session.selected_item_id);
            const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

            const result = db.prepare(
                `INSERT INTO orders (user_id, user_name, item_id, item_name, category, price, payment_method, order_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(userId, userName, item.id, item.name, item.category, item.price, paymentMethod, today);

            // Clear session
            db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);

            bot.sendMessage(
                chatId,
                `🎉 *Order Confirmed!* (Order #${result.lastInsertRowid})\n\n` +
                `Item: *${item.name}*\n` +
                `Price: *${item.price} ETB*\n` +
                `Payment: *${paymentMethod}*\n\n` +
                `Send /menu to log another order or /report for daily totals.`,
                { parse_mode: 'Markdown' }
            );
        } else {
            bot.sendMessage(chatId, 'Session expired. Send /menu to select an item again.');
        }
    }

    bot.answerCallbackQuery(query.id);
});

// Helper: Daily Sales Summary
function sendDailyReport(chatId) {
    const today = new Date().toLocaleDateString('en-CA');

    const overall = db.prepare(
        `SELECT COUNT(*) as total_orders, COALESCE(SUM(price), 0) as total_revenue FROM orders WHERE order_date = ?`
    ).get(today);

    const payments = db.prepare(
        `SELECT payment_method, COUNT(*) as count, SUM(price) as amount FROM orders WHERE order_date = ? GROUP BY payment_method`
    ).all(today);

    const items = db.prepare(
        `SELECT item_name, category, COUNT(*) as qty, SUM(price) as total FROM orders WHERE order_date = ? GROUP BY item_id ORDER BY qty DESC`
    ).all(today);

    let report = `📊 *DAILY SALES REPORT (${today})*\n\n`;
    report += `💰 *Total Revenue:* ${overall.total_revenue} ETB (${overall.total_orders} items sold)\n\n`;

    report += `💳 *Payment Method Breakdown:*\n`;
    if (payments.length === 0) {
        report += `• No orders logged today.\n`;
    } else {
        payments.forEach(p => {
            report += `• ${p.payment_method}: ${p.amount} ETB (${p.count} sales)\n`;
        });
    }

    report += `\n🍕 *Food Items Sold:*\n`;
    if (items.length === 0) {
        report += `• No items logged today.\n`;
    } else {
        items.forEach(i => {
            report += `• ${i.item_name}: ${i.qty}x (${i.total} ETB)\n`;
        });
    }

    bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
}