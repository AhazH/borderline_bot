require('dotenv').config();
const http = require('http');

// Dummy HTTP server to satisfy Render Web Service health checks
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Borderline Cafe Bot is running!');
}).listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
});

// Robust import handling for node-telegram-bot-api
const TelegramBotModule = require('node-telegram-bot-api');
const TelegramBot = TelegramBotModule.default || TelegramBotModule;

const Database = require('better-sqlite3');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN || TOKEN === '') {
    console.error('❌ Error: Please set a valid TELEGRAM_BOT_TOKEN in your .env file!');
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// --- 1. DATABASE SETUP (SQLite) ---
const db = new Database('./borderline_cafe.db');

db.exec(`
    CREATE TABLE IF NOT EXISTS menu_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        main_type TEXT NOT NULL,
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
    const insertStmt = db.prepare(`INSERT INTO menu_items (name, category, main_type, price) VALUES (?, ?, ?, ?)`);
    const menu = [
        // Food -> Pizza
        ['Super Deluxe Pizza', 'Pizza', 'Food', 1100],
        ['Special Borderline Pizza', 'Pizza', 'Food', 900],
        ['Chicken Pizza', 'Pizza', 'Food', 900],
        ['Meat Lover’s Pizza', 'Pizza', 'Food', 800],
        ['Tuna Pizza', 'Pizza', 'Food', 850],
        ['Tuna Fasting Pizza', 'Pizza', 'Food', 800],
        ['Vegetable Pizza', 'Pizza', 'Food', 650],
        ['Special Vegetable Pizza', 'Pizza', 'Food', 800],
        ['Margarita Pizza', 'Pizza', 'Food', 700],

        // Food -> Burger
        ['Chicken Burger', 'Burger', 'Food', 800],
        ['Special Chicken Burger', 'Burger', 'Food', 950],
        ['Special Beef Burger', 'Burger', 'Food', 950],
        ['Cheese Burger', 'Burger', 'Food', 700],
        ['Egg Burger', 'Burger', 'Food', 760],
        ['Normal Burger', 'Burger', 'Food', 600],
        ['Great Smash Burger', 'Burger', 'Food', 1400],
        ['Mini Special Burger', 'Burger', 'Food', 800],
        ['Jambo Special Burger', 'Burger', 'Food', 1250],

        // Food -> Burrito
        ['Chicken Burrito', 'Burrito', 'Food', 800],
        ['Beef Burrito', 'Burrito', 'Food', 750],
        ['Tuna Burrito', 'Burrito', 'Food', 750],
        ['Vegetable Burrito', 'Burrito', 'Food', 550],
        ['Special Borderline Burrito', 'Burrito', 'Food', 950],

        // Food -> Lunch
        ['Chicken Goulash', 'Lunch', 'Food', 800],
        ['Grilled Chicken', 'Lunch', 'Food', 900],

        // Food -> Sandwich
        ['Egg Sandwich', 'Sandwich', 'Food', 550],
        ['Tuna Club Sandwich', 'Sandwich', 'Food', 550],
        ['Tuna Sandwich', 'Sandwich', 'Food', 500],
        ['Beef Sandwich', 'Sandwich', 'Food', 600],
        ['Chicken Club Sandwich', 'Sandwich', 'Food', 700],
        ['Felafel Sandwich', 'Sandwich', 'Food', 450],
        ['Ham and Cheese', 'Sandwich', 'Food', 700],

        // Drinks
        ['Normal Juice', 'Juice', 'Drinks', 200],
        ['Mix Juice', 'Juice', 'Drinks', 250],
        ['Softdrinks', 'Cold Drinks', 'Drinks', 60],
        ['Coffee', 'Hot Drinks', 'Drinks', 40],
        ['Water', 'Cold Drinks', 'Drinks', 60]
    ];

    const insertMany = db.transaction((items) => {
        for (const item of items) insertStmt.run(item);
    });
    insertMany(menu);
    console.log('✅ Menu items seeded with structured categories successfully.');
}

console.log('🚀 Borderline Cafe Telegram Bot is live and listening!');

// --- 2. MAIN CATEGORY KEYBOARD HELPER ---
function sendMainCategories(chatId) {
    const mainTypeKeyboard = [
        [
            { text: '🍕 Food Menu', callback_data: 'main_Food' },
            { text: '🥤 Drinks Menu', callback_data: 'main_Drinks' }
        ]
    ];

    bot.sendMessage(chatId, ' Welcome to *Borderline Cafe*!\n\nPlease select a menu category:', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: mainTypeKeyboard }
    });
}

// --- 3. COMMAND HANDLERS ---
bot.onText(/\/(start|menu)/, (msg) => {
    sendMainCategories(msg.chat.id);
});

bot.onText(/\/report/, (msg) => {
    sendDailyReport(msg.chat.id);
});

// --- 4. BUTTON CALLBACK HANDLER ---
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const userName = query.from.first_name || 'Customer';
    const data = query.data;

    // Step 1: User Selected Top Category (Food or Drinks)
    if (data.startsWith('main_')) {
        const mainType = data.split('_')[1];

        if (mainType === 'Food') {
            // Show Food Sub-Categories
            const categories = db.prepare(`SELECT DISTINCT category FROM menu_items WHERE main_type = 'Food'`).all();
            
            const subCategoryKeyboard = categories.map(cat => [
                { text: `👉 ${cat.category}`, callback_data: `sub_${cat.category}` }
            ]);
            subCategoryKeyboard.push([{ text: '« Back to Main Menu', callback_data: 'go_main' }]);

            bot.sendMessage(chatId, '🍔 *Food Categories*\nSelect a category to view items:', {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: subCategoryKeyboard }
            });
        } else if (mainType === 'Drinks') {
            // Show All Drink Items directly
            const items = db.prepare(`SELECT * FROM menu_items WHERE main_type = 'Drinks' ORDER BY id`).all();
            
            const itemsKeyboard = items.map(item => [
                { text: `${item.name} — ${item.price} ETB`, callback_data: `item_${item.id}` }
            ]);
            itemsKeyboard.push([{ text: '« Back to Main Menu', callback_data: 'go_main' }]);

            bot.sendMessage(chatId, '🥤 *Drinks Menu*\nTap an item to order:', {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: itemsKeyboard }
            });
        }
    }

    // Step 2: User Selected a Food Sub-Category (Pizza, Burger, Burrito, etc.)
    if (data.startsWith('sub_')) {
        const categoryName = data.split('_')[1];
        const items = db.prepare(`SELECT * FROM menu_items WHERE category = ? ORDER BY id`).all(categoryName);

        const itemsKeyboard = items.map(item => [
            { text: `${item.name} — ${item.price} ETB`, callback_data: `item_${item.id}` }
        ]);
        itemsKeyboard.push([{ text: '« Back to Food Categories', callback_data: 'main_Food' }]);

        bot.sendMessage(chatId, `🍽️ *${categoryName} Menu*\nTap an item to place an order:`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: itemsKeyboard }
        });
    }

    // Step 3: Go Back to Main Menu
    if (data === 'go_main') {
        sendMainCategories(chatId);
    }

    // Step 4: User Selected a Menu Item
    if (data.startsWith('item_')) {
        const itemId = parseInt(data.split('_')[1], 10);
        const item = db.prepare(`SELECT * FROM menu_items WHERE id = ?`).get(itemId);

        if (item) {
            db.prepare(`INSERT OR REPLACE INTO sessions (user_id, selected_item_id) VALUES (?, ?)`).run(userId, item.id);

            const paymentKeyboard = [
                [{ text: '💵 Cash', callback_data: 'pay_Cash' }],
                [{ text: '📱 Telebirr', callback_data: 'pay_Telebirr' }],
                [{ text: '💳 eBirr', callback_data: 'pay_eBirr' }],
                [{ text: '🏦 Account Transfer', callback_data: 'pay_Account Transfer' }],
                [{ text: '« Cancel Order', callback_data: 'go_main' }]
            ];

            bot.sendMessage(chatId, `Selected: *${item.name}* (${item.price} ETB)\n\nSelect payment method:`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: paymentKeyboard }
            });
        }
    }

    // Step 5: User Selected Payment Method
    if (data.startsWith('pay_')) {
        const paymentMethod = data.split('_')[1];
        const session = db.prepare(`SELECT selected_item_id FROM sessions WHERE user_id = ?`).get(userId);

        if (session && session.selected_item_id) {
            const item = db.prepare(`SELECT * FROM menu_items WHERE id = ?`).get(session.selected_item_id);
            const today = new Date().toLocaleDateString('en-CA');

            const result = db.prepare(
                `INSERT INTO orders (user_id, user_name, item_id, item_name, category, price, payment_method, order_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(userId, userName, item.id, item.name, item.category, item.price, paymentMethod, today);

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
            bot.sendMessage(chatId, 'Session expired. Send /menu to start again.');
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

    report += `\n🍕 *Food & Drink Items Sold:*\n`;
    if (items.length === 0) {
        report += `• No items logged today.\n`;
    } else {
        items.forEach(i => {
            report += `• ${i.item_name} (${i.category}): ${i.qty}x (${i.total} ETB)\n`;
        });
    }

    bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
}
