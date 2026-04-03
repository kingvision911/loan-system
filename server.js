require("dotenv").config();

const db = require("./db");
const express = require("express");
const cors = require("cors");
const transporter = require("./email");
const cron = require("node-cron");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();

app.use(cors());
app.use(express.json());

function authenticateToken(req, res, next) {
    const authHeaders = req.headers["authorization"];

    if (!authHeaders) {
        return res.status(401).send("Access denied");
    }

    const token = authHeaders.split(" ")[1];

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).send("Invalid token");

        // 🔥 CHECK STATUS HERE
        const sql = `
            SELECT status FROM customers WHERE user_id = ?
        `;

        db.query(sql, [user.id], (err, result) => {
            if (err) return res.status(500).send(err);

            if (result.length && result[0].status === "blocked") {
                return res.status(403).send("Account blocked");
            }

            req.user = user;
            next();
        });
    });
}



function logFraudAttempt(national_id, email, req) {
    const ip = req.ip;

    const sql = `
        INSERT INTO fraud_attempts (national_id, email, ip_address)
        VALUES (?, ?, ?)
    `;

    db.query(sql, [national_id, email, ip], (err) => {
        if (err) console.log("Fraud log error:", err);
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
    SELECT 
    customers.id,
    users.name,
    users.email,
    customers.phone,
    customers.national_id,
    customers.status
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



app.put("/customers/:id/block", authenticateToken, isAdmin, (req, res) => {
    const customerId = req.params.id;

    const sql = `
        UPDATE customers 
        SET status = 'blocked'
        WHERE id = ?
    `;

    db.query(sql, [customerId], (err) => {
        if (err) return res.status(500).send(err);

        res.send("Customer blocked successfully");
    });
});



app.put("/customers/:id/unblock", authenticateToken, isAdmin, (req, res) => {
  const customerId = req.params.id;

  const sql = `
    UPDATE customers 
    SET status = 'active'
    WHERE id = ?
  `;

  db.query(sql, [customerId], (err) => {
    if (err) return res.status(500).send(err);

    res.send("Customer unblocked successfully");
  });
});



app.put("/customers/:id", authenticateToken, isAdmin, (req, res) => {
  const { name, phone, national_id } = req.body;
  const customerId = req.params.id;

  // update users + customers
  const sql = `
    UPDATE users u
    JOIN customers c ON u.id = c.user_id
    SET u.name = ?, c.phone = ?, c.national_id = ?
    WHERE c.id = ?
  `;

  db.query(sql, [name, phone, national_id, customerId], (err) => {
    if (err) return res.status(500).send(err);
    res.send("Customer updated successfully");
  });
});


// app.delete("/customers/:id", authenticateToken, isAdmin, (req, res) => {
//   const customerId = req.params.id;

//   const sql = "DELETE FROM customers WHERE id = ?";

//   db.query(sql, [customerId], (err) => {
//     if (err) return res.status(500).send(err);
//     res.send("Customer deleted");
//   });
// });


app.post("/create-user", async (req, res) => {
    const { name, email, password, phone, national_id } = req.body;

    try {
        // 🔒 STEP 1: Check email
        const checkEmailSql = "SELECT * FROM users WHERE email = ?";
        db.query(checkEmailSql, [email], async (err, emailResult) => {
            if (err) return res.status(500).send("Database error");

            if (emailResult.length > 0) {
                return res.status(400).send("Email already exists");
            }

            // 🔒 STEP 2: Check national ID
            const checkIdSql = "SELECT * FROM customers WHERE national_id = ?";

            db.query(checkIdSql, [national_id], async (err, idResult) => {
                if (err) return res.status(500).send("Database error");

                if (idResult.length > 0) {

                    // 🔥 LOG FRAUD ATTEMPT
                    logFraudAttempt(national_id, email, req);

                    return res.status(400).send("National ID already registered");
                }

                // ✅ STEP 3: Create user safely
                const hashedPassword = await bcrypt.hash(password, 10);

                const userSql = `
                    INSERT INTO users (name, email, password, role)
                    VALUES (?, ?, ?, 'customer')
                `;

                db.query(userSql, [name, email, hashedPassword], (err, userResult) => {
                    if (err) return res.status(500).send("Database error");

                    const userId = userResult.insertId;

                    // ✅ STEP 4: Create customer
                    const customerSql = `
                        INSERT INTO customers (user_id, phone, national_id)
                        VALUES (?, ?, ?)
                    `;

                    db.query(customerSql, [userId, phone, national_id], (err) => {
                        if (err) return res.status(500).send("Database error");

                        res.send("Account created successfully!");
                    });
                });
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
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).send("All fields are required");
        }

        const checkSql = "SELECT * FROM users WHERE role = 'admin'";

        db.query(checkSql, async (err, result) => {
            if (err) return res.status(500).send(err);

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
            } else {
                const authHeader = req.headers["authorization"];

                if (!authHeader) {
                    return res.status(403).send("Access denied: No token");
                }

                const token = authHeader.split(" ")[1];

                jwt.verify(token, process.env.JWT_SECRET, async (err, user) => {
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

    } catch (error) {
        console.log("🔥 CREATE ADMIN ERROR:", error);
        res.status(500).send("Server crashed");
    }
});


app.post("/login", (req, res) => {
    const { email, password } = req.body;

    const sql = `
        SELECT users.*, customers.status
        FROM users
        LEFT JOIN customers ON users.id = customers.user_id
        WHERE users.email = ?
    `;

    db.query(sql, [email], async (err, result) => {
        if (err) return res.status(500).send(err);

        // ✅ STEP 1: Check if user exists
        if (result.length === 0) {
            return res.status(401).json({
                message: "User not found",
                field: "email"
            });
        }

        // ✅ STEP 2: Get user AFTER checking result
        const user = result[0];

        // ✅ STEP 3: Check password exists
        if (!user.password) {
            return res.status(500).json({
                message: "User password missing in DB"
            });
        }

        // ✅ STEP 4: Compare password
        const match = await bcrypt.compare(password, user.password);

        if (!match) {
            return res.status(401).json({
                message: "Wrong password",
                field: "password"
            });
        }

        // 🔥 STEP 5: Check if BLOCKED (AFTER password check)
        if (user.role === "customer" && user.status === "blocked") {
            return res.status(403).json({
                message: "Account is blocked",
                field: "email"
            });
        }

        // ✅ STEP 6: Generate token
        const token = jwt.sign(
            { id: user.id, role: user.role, name: user.name },
            process.env.JWT_SECRET,
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
        const customerSql = `
            SELECT id, status 
            FROM customers 
            WHERE user_id = ?
        `;

        db.query(customerSql, [userId], (err, customerResult) => {
            if (err) return res.status(500).send(err);

            if (customerResult.length === 0) {
                return res.status(404).send("Customer record not found");
            }

            const customer = customerResult[0];

            // 🚫 BLOCKED CHECK
            if (customer.status === "blocked") {
                return res.status(403).send("User is blocked or suspended");
            }

            const customerId = customer.id;

            // Step 3 continues...

            

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

                    if (!amount || amount <= 0) {
                    return res.status(400).send("Invalid loan amount");
                    }

                    if (amount < 1000) {
                    return res.status(400).send("Minimum loan is 1000");
                    }

                    if (interest_rate < 0 || interest_rate > 100) {
                    return res.status(400).send("Invalid interest rate only 1% to 100%");
                    }

                    if (new Date(due_date) <= new Date(start_date)) {
                    return res.status(400).send("Invalid dates");
                    }

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


app.get("/customer-loans/:email", authenticateToken, isAdmin, (req, res) => {
    const email = req.params.email;

    const sql = `
        SELECT loans.*
        FROM loans
        JOIN customers ON loans.customer_id = customers.id
        JOIN users ON customers.user_id = users.id
        WHERE users.email = ?
    `;

    db.query(sql, [email], (err, result) => {
        if (err) return res.status(500).send(err);
        res.json(result);
    });
});



app.get("/loan-payments/:loanId", authenticateToken, isAdmin, (req, res) => {
  const loanId = req.params.loanId;

  const sql = `
    SELECT amount, payment_date
    FROM payments
    WHERE loan_id = ?
    ORDER BY payment_date ASC
  `;

  db.query(sql, [loanId], (err, result) => {
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
            VALUES (?, ?, NOW())
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
            (SELECT COUNT(*) 
            FROM customers 
            WHERE created_at >= NOW() - INTERVAL 1 DAY) AS new_customers,

            (SELECT COUNT(*) 
            FROM payments 
            WHERE payment_date >= NOW() - INTERVAL 1 DAY) AS payments_today,

            (SELECT IFNULL(SUM(amount),0) 
            FROM payments 
            WHERE payment_date >= NOW() - INTERVAL 1 DAY) AS total_paid_today,

            (SELECT IFNULL(SUM(amount),0) 
            FROM loans) AS total_loaned
        `;

    db.query(sql, (err, result) => {
        if(err) return console.log(err);

        const data = result[0];

        const mailOptions = {
        from: process.env.EMAIL_USER,
        to: process.env.EMAIL_USER, 
        bcc: process.env.EMAIL_USER1,
        subject: "Daily Loan Report (Last 24 Hours)",

        html: `
            <div style="font-family: Arial, sans-serif; background:#f4f4f4; padding:20px;">
            
            <div style="max-width:600px; margin:auto; background:white; padding:25px; border-radius:10px;">
                
                <!-- 🔷 HEADER -->
                <h1 style="text-align:center; margin-bottom:5px;">
                💰 Loan System
                </h1>

                <h3 style="text-align:center; color:#2c3e50; margin-top:0;">
                Daily Report (Last 24 Hours)
                </h3>

                <p style="text-align:center; color:gray; font-size:13px;">
                Generated on: ${new Date().toLocaleString()}
                </p>

                <hr style="margin:20px 0;">

                <!-- 🔷 TABLE -->
                <table style="width:100%; border-collapse: collapse;">
                
                <tr>
                    <td style="padding:12px; border-bottom:1px solid #ddd;">New Customers</td>
                    <td style="padding:12px; border-bottom:1px solid #ddd; text-align:right;">
                    ${Number(data.new_customers || 0).toLocaleString()}
                    </td>
                </tr>

                <tr>
                    <td style="padding:12px; border-bottom:1px solid #ddd;">Payments Made</td>
                    <td style="padding:12px; border-bottom:1px solid #ddd; text-align:right;">
                    ${Number(data.payments_today || 0).toLocaleString()}
                    </td>
                </tr>

                <tr>
                    <td style="padding:12px; border-bottom:1px solid #ddd;">Total Paid (24h)</td>
                    <td style="padding:12px; border-bottom:1px solid #ddd; text-align:right; color:green; font-weight:bold;">
                    TZS ${Number(data.total_paid_today || 0).toLocaleString()}
                    </td>
                </tr>

                <tr>
                    <td style="padding:12px; font-weight:bold;">Total Loaned</td>
                    <td style="padding:12px; text-align:right; font-weight:bold;">
                    TZS ${Number(data.total_loaned || 0).toLocaleString()}
                    </td>
                </tr>

                </table>

                <hr style="margin:25px 0;">

                <!-- 🔷 FOOTER -->
                <p style="text-align:center; font-size:12px; color:gray;">
                This is an automated financial report generated by Kingvision Loan System.
                </p>

            </div>
            </div>
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



app.get("/loans/:id/balance", (req, res) => {
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

app.get("/customers/search", (req, res) => {
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


const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});