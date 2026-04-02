const express = require("express");
const cors = require("cors");
const db = require("./db");
const transporter = require("./email");
const cron = require("node-cron");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();

app.use(cors());
app.use(express.json());

function authenticateToken(req, res, next) {
    const authHeaders = req.headers["authorization"];

    if(!authHeaders) {
        return res.status(401).send("Access denied");
    }

    const token = authHeaders.split(" ")[1];

    jwt.verify(token, "SECRET_KEY", (err, user) => {
        if (err) return res.status(403).send("Invalid token");

        req.user = user;
        next();
    });
}

function isAdmin(req, res, next) {
    if (req.user.role !== "admin") {
        return res.status(403).send("Admin access only");
    }
    next()
}

app.get("/", (req, res) => {
    res.send("Loan System API is running 🚀");
});



app.get("/customers", authenticateToken, (req, res) => {
    const sql = `
    SELECT customers.id, users.name, users.email, customers.phone
    FROM customers
    JOIN users ON customers.user_id = users.id
  `;

    db.query(sql, (err, result) => {
        if (err) {
            res.status(500).send(err);
        } else {
            res.json(result);
        }
    });
});



app.post("/create-user", async (req, res) => {
    const { name, email, password, phone, national_id } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        // STEP 1: Create user
        const userSql = `
            INSERT INTO users (name, email, password, role)
            VALUES (?, ?, ?, 'customer')
        `;

        db.query(userSql, [name, email, hashedPassword], (err, userResult) => {
            if (err) {
                if (err.code === "ER_DUP_ENTRY") {
                    return res.status(400).send("User already exists");
                }
                return res.status(500).send("Database error");
            }

            const userId = userResult.insertId;

            // STEP 2: Create customer linked to user
            const customerSql = `
                INSERT INTO customers (user_id, phone, national_id)
                VALUES (?, ?, ?)
            `;

            db.query(customerSql, [userId, phone, national_id], (err) => {
                if (err) {
                    if (err.code === "ER_DUP_ENTRY") {
                        return res.status(400).send("User already exists");
                    }
                    return res.status(500).send("Database error");
                }

                res.send("Account Created successfully!");
            });
        });

    } catch (err) {
        res.status(500).send(err);
    }
});


app.get("/check-admin", (req, res) => {
    const sql = "SELECT COUNT(*) AS count FROM users WHERE role = 'admin'";

    db.query(sql, (err, result) => {
        if (err) return res.status(500).send(err);

        const adminExists = result[0].count > 0;

        res.json({ adminExists });
    });
});


app.post("/create-admin", async (req, res) => {
    const { name, email, password } = req.body;

    const checkSql = "SELECT * FROM users WHERE role = 'admin'";

    db.query(checkSql, async (err, result) => {
        if (err) return res.status(500).send(err);

        //  FIRST ADMIN (no auth required)
        if (result.length === 0) {
            const hashedPassword = await bcrypt.hash(password, 10);

            const sql = `
                INSERT INTO users (name, email, password, role)
                VALUES (?, ?, ?, 'admin')
            `;

            db.query(sql, [name, email, hashedPassword], (err) => {
                if (err) return res.status(500).send(err);

                return res.send("First admin created");
            });
        } 
        
        // 🔒 AFTER FIRST ADMIN → REQUIRE TOKEN
        else {
            // ❗ MANUALLY CHECK TOKEN
            const authHeader = req.headers["authorization"];

            if (!authHeader) {
                return res.status(403).send("Access denied: No token");
            }

            const token = authHeader.split(" ")[1];

            jwt.verify(token, "SECRET_KEY", async (err, user) => {
                if (err) return res.status(403).send("Invalid token");

                if (user.role !== "admin") {
                    return res.status(403).send("Access denied: Admin only");
                }

                const hashedPassword = await bcrypt.hash(password, 10);

                const sql = `
                    INSERT INTO users (name, email, password, role)
                    VALUES (?, ?, ?, 'admin')
                `;

                db.query(sql, [name, email, hashedPassword], (err) => {
                    if (err) return res.status(500).send(err);

                    res.send("Admin created successfully");
                });
            });
        }
    });
});


app.post("/login", (req, res) => {
    const { email, password } = req.body;

    const sql = "SELECT * FROM users WHERE email = ?";

    db.query(sql, [email], async (err, result) => {
        if (err) return res.status(500).send(err);

        if (result.length === 0) {
            return res.status(401).json({message: "User not found", field: "email" });
        }

        const user = result[0];

        if (!user.password) {
            return res.status(500).json({ message: "User password missing in the DB"})
        }
        const match = await bcrypt.compare(password, user.password);

        if (!match) {
            return res.status(401).json({message: "Wrong password", field: "password" });
        }

        const token = jwt.sign({ 
            id: user.id,
            role: user.role,
            name: user.name
        },            
            "SECRET_KEY",
            { expiresIn: "1d" }
        );

        res.json({ token });
    });
});



app.post("/loans", authenticateToken, isAdmin, (req, res) => {
    const { email, amount, interest_rate, start_date, due_date } = req.body;

    // Step 1: find user by email
    const userSql = "SELECT id FROM users WHERE email = ?";

    db.query(userSql, [email], (err, userResult) => {
        if (err) return res.status(500).send(err);

        if (userResult.length === 0) {
            return res.status(404).send("User not found");
        }

        const userId = userResult[0].id;

        // Step 2: find customer by user_id
        const customerSql = "SELECT id FROM customers WHERE user_id = ?";

        db.query(customerSql, [userId], (err, customerResult) => {
            if (err) return res.status(500).send(err);

            if (customerResult.length === 0) {
                return res.status(404).send("Customer record not found");
            }

            const customerId = customerResult[0].id;

            // Step 3: create loan
            const loanSql = `
            INSERT INTO loans (customer_id, amount, interest_rate, start_date, due_date)
            VALUES (?, ?, ?, ?, ?)
            `;

            db.query(
                loanSql,
                [customerId, amount, interest_rate, start_date, due_date],
                (err) => {
                    if (err) return res.status(500).send(err);

                    res.send("Loan created successfully!");
                }
            );
        });
    });
});


app.get("/my-loans", authenticateToken, (req, res) => {
    const userId = req.user.id;

    const sql = `
        SELECT loans.*
        FROM loans
        JOIN customers ON loans.customer_id = customers.id
        WHERE customers.user_id = ?
    `;

    db.query(sql, [userId], (err, result) => {
        if (err) return res.status(500).send(err);
        res.json(result);
    });
});


app.get("/loans", (req, res) => {
    db.query("SELECT * FROM loans", (err, result) => {
        if (err) return res.status(500).send(err);
        res.json(result);
    });
});


app.post("/payments", authenticateToken, (req, res) => {
    const { loan_id, amount } = req.body;

    // Step 1: get loan + payments
    const sql = `
        SELECT l.amount, l.interest_rate,
               IFNULL(SUM(p.amount), 0) AS paid
        FROM loans l
        LEFT JOIN payments p ON l.id = p.loan_id
        WHERE l.id = ?
        GROUP BY l.id
    `;

    db.query(sql, [loan_id], (err, result) => {
        if (err) return res.status(500).send(err);

        if (result.length === 0) {
            return res.status(404).send("Loan not found");
        }

        const loan = result[0];

        const principal = parseFloat(loan.amount);
        const interest = (principal * loan.interest_rate) / 100;
        const total = principal + interest;
        const paid = parseFloat(loan.paid);
        const remaining = total - paid;

        // Prevent overpayment
        if (amount > remaining) {
            return res.status(400).send(`Max allowed is ${remaining}`);
        }

        // Prevent payment if already paid
        if (remaining <= 0) {
            return res.status(400).send("Loan already fully paid");
        }

        // Insert payment
        const insertSql = `
            INSERT INTO payments (loan_id, amount, payment_date)
            VALUES (?, ?, CURDATE())
        `;

        db.query(insertSql, [loan_id, amount], (err) => {
            if (err) return res.status(500).send(err);

            // STEP 2: Recalculate total paid after inserting payment
            const recheckSql = `
                SELECT l.amount, l.interest_rate,
                    IFNULL(SUM(p.amount), 0) AS paid
                FROM loans l
                LEFT JOIN payments p ON l.id = p.loan_id
                WHERE l.id = ?
                GROUP BY l.id
            `;

            db.query(recheckSql, [loan_id], (err, result2) => {
                if (err) return res.status(500).send(err);

                const loan = result2[0];

                const principal = parseFloat(loan.amount);
                const interest = (principal * loan.interest_rate) / 100;
                const total = principal + interest;
                const paid = parseFloat(loan.paid);

                let status = "active";

                // STEP 3: Determine status
                if (paid >= total) {
                    status = "paid";
                }

                // OPTIONAL: overdue logic (only if you have due_date column)
                if (loan.due_date && new Date() > new Date(loan.due_date) && paid < total) {
                    status = "overdue";
                }

                // STEP 4: Update loan status in DB
                const updateStatusSql = `
                    UPDATE loans 
                    SET status = ?
                    WHERE id = ?
                `;

                db.query(updateStatusSql, [status, loan_id], (err) => {
                    if (err) return res.status(500).send(err);

                    res.send({
                        message: "Payment successful",
                        status: status
                    });
                });
            });
        });
    });
});

app.get("/loans/overdue", (req, res) => {
    const sql = `
    SELECT * FROM loans
    WHERE due_date < CURDATE()
    AND status = 'active'
    `;

    db.query(sql, (err, result) => {
        if (err) return res.status(500).send(err);
        res.json(result);
    });
});

app.get("/dashboard", (req, res) => {
    const sql = `
    SELECT 
        (SELECT COUNT(*) FROM customers) AS total_customers,
        (SELECT COUNT(*) FROM loans WHERE status = 'active') AS active_loans,
        (SELECT IFNULL(SUM(amount),0) FROM payments) AS total_paid,
        (SELECT IFNULL(SUM(amount),0) FROM loans) AS total_loaned
    `;

    db.query(sql, (err, result) => {
        if(err) return res.status(500).send(err);

        const data = result[0];

        data.profit = data.total_paid - data.total_loaned;

        res.json(data);
    });
});

app.get("/profit/expected", (req, res) => {
    const sql = `
    SELECT 
        SUM(amount + (amount * interest_rate / 100)) AS expected_total
    FROM loans
    WHERE status = 'active'
    `;

    db.query(sql, (err, result) => {
        if (err) return res.status(500).send(err);

        res.json(result[0]);
    });
});

app.get("/report/daily", (req, res) => {
    const sql = `
    SELECT 
        (SELECT COUNT(*) FROM customers WHERE DATE(created_at) = CURDATE()) AS new_customers,
        COUNT(payments.id) AS payments_today,
        IFNULL(SUM(payments.amount), 0) AS total_paid_today
    FROM payments
    WHERE DATE(payment_date) = CURDATE()

    `;

    db.query(sql, (err, result) => {
        if (err) return res.status(500).send(err);
        res.json(result[0]);
    });
});

function sendDailyReport() {
    const sql = `
        SELECT 
        (SELECT COUNT(*) FROM customers WHERE DATE(created_at) = CURDATE()) AS new_customers,
        (SELECT COUNT(*) FROM payments WHERE DATE(payment_date) = CURDATE()) AS payments_today,
        (SELECT IFNULL(SUM(amount),0) FROM payments WHERE DATE(payment_date) = CURDATE()) AS total_paid_today,
        (SELECT IFNULL(SUM(amount),0) FROM loans) AS total_loaned
    `;

    db.query(sql, (err, result) => {
        if(err) return console.log(err);

        const data = result[0];

        const mailOptions = {
            from: "kingvision911@gmail.com",
            to: "kingvision911@gmail.com", 
            subject: "Daily Loan System Report",
            text: `
                New Customers: ${data.new_customers}
                Payments Today: ${data.payments_today}
                Total Paid Today: ${data.total_paid_today}
                Total Loaned: ${data.total_loaned}
            `
        };

         transporter.sendMail(mailOptions, (err, info) => {
            if (err) {
                console.log("Email error:", err);
            } else {
                console.log("Email sent:", info.response);
            }
        });
    });
}



app.get("/loans/:id/balance", authenticateToken, (req, res) => {
    const loanId = req.params.id;

    const sql = `    
    SELECT 
        l.id,
        l.amount AS total_loan,
        IFNULL(SUM(p.amount), 0) AS total_paid,
        (l.amount - IFNULL(SUM(p.amount), 0)) AS remaining
    FROM loans l
    LEFT JOIN payments p ON l.id = p.loan_id
    WHERE l.id = ?
    GROUP BY l.id
    `;

    db.query(sql, [loanId], (err, result) => {
        if (err) return res.status(500).send(err);
        res.json(result[0]);
    });
});

app.get("/customers/search", authenticateToken, (req, res) => {
    const query = req.query.q;

    const sql = `
    SELECT users.email, users.name
    FROM users
    JOIN customers ON users.id = customers.user_id
    WHERE users.email LIKE ? OR users.name LIKE ?
    LIMIT 10
    `;

    db.query(sql, [`%${query}%`, `%${query}%`], (err, result) => {
       if (err) return res.status(500).send(err);
       res.json(result); 
    });
});


app.get("/loan-balance/:loanId", (req, res) => {
    const loanId = req.params.loanId;

    const sql = `
        SELECT l.amount, l.interest_rate,
               IFNULL(SUM(p.amount), 0) AS paid
        FROM loans l
        LEFT JOIN payments p ON l.id = p.loan_id
        WHERE l.id = ?
        GROUP BY l.id
    `;

    db.query(sql, [loanId], (err, result) => {
        if (err) return res.status(500).send(err);

        if (result.length === 0) {
            return res.status(404).send("Loan not found");
        }

        const loan = result[0];

        const principal = parseFloat(loan.amount);
        const interest = (principal * loan.interest_rate) / 100;
        const totalOwed = principal + interest;
        const paid = parseFloat(loan.paid);
        const balance = totalOwed - paid;

        res.json({
            principal,
            interest,
            total_owed: totalOwed,
            paid,
            balance
        });
    });
});

cron.schedule("0 0 * * *", () => {
    console.log("Running daily report...");
    sendDailyReport();
});

// app.listen(3000, () => {
//     console.log("Server running on port 3000");
// });

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});