const API_URL = "http://localhost:3000";

// const API_URL = window.location.hostname === "localhost"
//   ? "http://localhost:3000"
//   : "https://loan-system-59i2.onrender.com";


document.addEventListener("DOMContentLoaded", () => {
  checkAdminSetup();
});

function checkAdminSetup() {
  fetch(`${API_URL}/check-admin`)
    .then(res => res.json())
    .then(data => {
      if (!data.adminExists) {
        // SHOW button if no admin
        document.getElementById("setupAdminBtn").style.display = "block";
      }
    })
    .catch(err => console.log(err));
}

function formatDate(dateString) {
  if (!dateString) return "N/A";

  const date = new Date(dateString);
  return date.toLocaleDateString();
}

let token = "";
let selectedEmail = "";


// Trigger search while typing
document.getElementById("loanSearch").addEventListener("input", function () {
  const query = this.value;

  if (query.length < 2) return;

  fetch(`${API_URL}/customers/search?q=${query}`, {
    headers: {
      "Authorization": "Bearer " + token
    }
  })
  .then(res => res.json())
  .then(data => {
    const list = document.getElementById("searchResults");
    list.innerHTML = "";

    data.forEach(user => {
      const li = document.createElement("li");
      li.textContent = `${user.name} (${user.email})`;

      li.onclick = () => {
        selectedEmail = user.email;
        document.getElementById("loanSearch").value = user.email;
        list.innerHTML = "";
      };

      list.appendChild(li);
    });
  });
});

document.addEventListener("click", (e) => {
  if (!document.querySelector(".search-box").contains(e.target)) {
    document.getElementById("searchResults").innerHTML = "";
  }
});

// LOGIN
function login() {
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const errorBox = document.getElementById("loginError");

  const email = emailInput.value;
  const password = passwordInput.value;

  fetch(`${API_URL}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  })
  .then(async res => {
    const data = await res.json();

    if (!res.ok) {
      //  Show error under button
      errorBox.textContent = data.message;

      //  Clear only wrong field
      if (data.field === "password") {
        passwordInput.value = "";
      } else if (data.field === "email") {
        emailInput.value = "";
      }

      return;
    }

    // Clear error
    errorBox.textContent = "";

    // Save token
    token = data.token;

    localStorage.setItem("token", token);


    document.getElementById("login").style.display = "none";

  
    const user = parseJwt(token);


    document.getElementById("welcomeText").textContent = "Welcome " + user.name;

    if (user.role === "admin") {
      document.getElementById("adminPanel").style.display = "block";
      document.getElementById("createAdminBtn").style.display ="block";
    } else {
      document.getElementById("welcomeUser").textContent = "Welcome " + user.name;
      document.getElementById("customerPanel").style.display = "block";

      const btn = document.getElementById("createAdminBtn");
      if (btn) btn.style.display = "none";
    }

  })
  .catch(err => {
    console.log(err);
    errorBox.textContent = "Server error";
  });
}


function showRegister() {
  document.getElementById("login").style.display = "none";
  document.getElementById("register").style.display = "block";
}


function createUser() {
  const name = document.getElementById("userName").value;
  const email = document.getElementById("userEmail").value;
  const password = document.getElementById("userPassword").value;
  const phone = document.getElementById("userPhone").value;
  const national_id = document.getElementById("userNationalId").value;

  if (!name || !email || !password || !phone || !national_id) {
    alert("Please fill all fields");
    return;
  }

  fetch(`${API_URL}/create-user`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token
    },
    body: JSON.stringify({
      name,
      email,
      password,
      phone,
      national_id
    })
  })
  .then(async res => {
      const msg = await res.text();
  
    if (!res.ok) {
      alert("Error: " + msg);
      return;
    }

    alert(msg);
    document.getElementById("userName").value = "";
    document.getElementById("userEmail").value = "";
    document.getElementById("userPassword").value = "";
    document.getElementById("userPhone").value = "";
    document.getElementById("userNationalId").value = "";

    // switch UI
    document.getElementById("register").style.display = "none";
    document.getElementById("login").style.display = "block";

    document.getElementById("email").focus();
  });
}

function createAdmin() {
  const name = prompt("Admin name");
  const email = prompt("Admin email");
  const password = prompt("Admin password");

  console.log("TOKEN:", token);

  fetch(`${API_URL}/create-admin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": token ? "Bearer " + token : ""
    },
    body: JSON.stringify({ name, email, password })
  })
  .then(async res => {
    const msg = await res.text();

    if (!res.ok) {
      alert("ERROR: " + msg);
      return;
    }

    alert(msg);
  })
  .catch(err => {
    console.log(err);
    alert("Server error");
  });
}


function parseJwt(token) {
    const base64Url = token.split('.')[1];
    const base64 = atob(base64Url);
    return JSON.parse(base64);
}



// LOAD CUSTOMERS
function loadCustomers() {
  fetch(`${API_URL}/customers`, {
    headers: {
      "Authorization": "Bearer " + token
    }
  })
  .then(res => res.json())
  .then(data => {

    const container = document.getElementById("customerList");
    container.innerHTML = "";

    if (!data.length) {
      container.innerHTML = "<p>No customers found</p>";
      return;
    }

    let table = `
      <table border="1" style="border-collapse: collapse; width:100%; background:white;">
        <thead style="background:#2c3e50; color:white;">
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Phone</th>
            <th>National ID</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
    `;

    data.forEach(c => {

      const isBlocked = c.status === "blocked";

      table += `
        <tr style="${isBlocked ? 'background-color:#ffe6e6; color:red;' : ''}">
          <td style="font-weight:${isBlocked ? 'bold' : 'normal'}">
          ${c.name}
        </td>
          <td>${c.email}</td>
          <td>${c.phone}</td>
          <td>${c.national_id}</td>
          <td>
            <button onclick="viewCustomerLoans(\`${c.email}\`)">View</button>
            <button onclick="editCustomer(${c.id}, '${c.name}', '${c.phone}', '${c.national_id}')">Edit</button>
            
            ${
              isBlocked
                ? `<button onclick="unblockCustomer(${c.id})">Unblock</button>`
                : `<button onclick="blockCustomer(${c.id})">Block</button>`
            }

          </td>
        </tr>
      `;
    });

    table += `</tbody></table>`;

    container.innerHTML = table;
  });
}


function editCustomer(id, name, phone, national_id) {
  const newName = prompt("Edit Name", name);
  const newPhone = prompt("Edit Phone", phone);
  const newId = prompt("Edit National ID", national_id);

  fetch(`${API_URL}/customers/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token
    },
    body: JSON.stringify({
      name: newName,
      phone: newPhone,
      national_id: newId
    })
  })
  .then(res => res.text())
  .then(msg => {
    alert(msg);
    loadCustomers();
  });
}


function blockCustomer(id) {
  if (!confirm("Block this customer?")) return;

  fetch(`${API_URL}/customers/${id}/block`, {
    method: "PUT",
    headers: {
      "Authorization": "Bearer " + token
    }
  })
  .then(res => res.text())
  .then(msg => {
    alert(msg);
    loadCustomers();
  });
}


function unblockCustomer(id) {
  if (!confirm("Unblock this customer?")) return;

  fetch(`${API_URL}/customers/${id}/unblock`, {
    method: "PUT",
    headers: {
      "Authorization": "Bearer " + token
    }
  })
  .then(res => res.text())
  .then(msg => {
    alert(msg);
    loadCustomers();
  });
}


function loadMyLoans() {
  fetch(`${API_URL}/my-loans`, {
    headers: {
      "Authorization": "Bearer " + token
    }
  })
  .then(res => res.json())
  .then(data => {
    const list = document.getElementById("loanList");
    list.innerHTML = "";

    const container = document.getElementById("myLoans");
    container.innerHTML = "";

    if (!Array.isArray(data) || data.length === 0) {

      container.innerHTML = `
        <div style="
          padding: 15px;
          border: 1px solid green;
          width: 20%;
          border-radius: 8px;
          color: green;
          background: #f0fff0;
        ">
          No loans yet
        </div>
      `;
      return;
    }

    data.forEach(l => {
      const div = document.createElement("div");

      div.innerHTML = `<p>Balance: not Loaded</p>`;

      const li = document.createElement("li");

      // Loan info
      const info = document.createElement("div");
      info.textContent = `Loan Borrowed: ${l.amount} | Due: ${formatDate(l.due_date)}`;

      // Balance display
      const balanceText = document.createElement("p");
      balanceText.textContent = "Balance: not loaded";

      // Payment input
      const input = document.createElement("input");
      input.placeholder = "Enter payment amount";

      // Payment button
      const payBtn = document.createElement("button");
      payBtn.textContent = "Pay";

      const status = document.createElement("p");

      fetch(`${API_URL}/loan-balance/${l.id}`)
      .then(res => res.json())
      .then(data => {
        let paid = "";

        if (data.balance <= 0) {
          paid = `PAID (Tatal: ${data.total_owed})`;

          status.textContent = `PAID (Tatal: ${data.total_owed})`;
          status.style.color = "green";

          input.style.display = "none";
          payBtn.style.display = "none";
        } else {
          input.max = data.balance;
        }
   

            div.innerHTML = `
            <p><strong>Amount:</strong> ${l.amount}</p>
            <p><strong>Interest:</strong> ${data.interest}</p>
            <p><strong>Total owed:</strong> ${data.total_owed}</p>
            <p><strong>Paid:</strong> ${data.paid} </p>
            <p><strong>Remaining Balance:</strong> ${data.balance}</p>
            <p><strong>Status:</strong> ${l.status}</p>
            <p><strong>Borrowed On:</strong> ${formatDate(l.start_date)}</p>
            <p><strong>Due Date:</strong> ${formatDate(l.due_date)}</p>
            <p><strong>${paid}</strong></p>
            <hr>`;

          balanceText.textContent = `
          Balance To Be Paid: ${data.balance}
          `;

      });

      // Balance button
      // const balanceBtn = document.createElement("button");
      // balanceBtn.textContent = "View Balance";

      // Connect actions
      // balanceBtn.onclick = () => viewBalance(l.id, balanceText);
      payBtn.onclick = () => makePayment(l.id, input, balanceText);

      // Append everything
      li.appendChild(info);
      // li.appendChild(balanceBtn);
      li.appendChild(balanceText);
      li.appendChild(input);
      li.appendChild(payBtn);
      li.appendChild(status);
      container.appendChild(div);

      list.appendChild(li);
    });
  });
}




async function viewCustomerLoans(email = null) {

  // ✅ Decide which email to use
  const targetEmail = email || selectedEmail;

  if (!targetEmail) {
    alert("Please select a customer first");
    return;
  }

  const res = await fetch(`${API_URL}/customer-loans/${targetEmail}`, {
    headers: { "Authorization": "Bearer " + token }
  });

  const loans = await res.json();

  const container = document.getElementById("customerLoans");
  container.innerHTML = "";

  if (!Array.isArray(loans) || loans.length === 0) {
    container.innerHTML = "<p>No records found</p>";
    return;
  }

  let fullHTML = "";

  for (let l of loans) {

    // 🔹 Get balance
    const balanceRes = await fetch(`${API_URL}/loan-balance/${l.id}`);
    const balance = await balanceRes.json();

    // 🔹 Get payments
    const paymentsRes = await fetch(`${API_URL}/loan-payments/${l.id}`, {
      headers: { "Authorization": "Bearer " + token }
    });
    const payments = await paymentsRes.json();

    // 🔥 Payment rows
    let paymentRows = "";

    if (payments.length === 0) {
      paymentRows = `
        <tr>
          <td colspan="2" style="text-align:center; color:gray;">
            No payments yet
          </td>
        </tr>
      `;
    } else {
      paymentRows = payments.map(p => `
        <tr>
          <td>${formatDate(p.payment_date)}</td>
          <td>${Number(p.amount).toLocaleString()}</td>
        </tr>
      `).join("");
    }

    // 🔥 FULL TABLE PER LOAN
    fullHTML += `
      <table style="
        width:100%;
        border-collapse: collapse;
        margin-bottom: 40px;
        background: white;
        border-radius: 10px;
        overflow: hidden;
      " border="1">

        <!-- 🔷 LOAN DETAILS -->
        <tr style="background:#2c3e50; color:white;">
          <th colspan="2">
            Loan Details On Date: ${formatDate(l.start_date)}
          </th>
        </tr>

        <tr>
          <td style="padding:10px;">Customer</td>
          <td>${l.name || ""} (${l.email || targetEmail})</td>
        </tr>

        <tr>
          <td style="padding:10px;">Amount Borrowed</td>
          <td>${Number(l.amount || 0).toLocaleString()}</td>
        </tr>

        <tr>
          <td style="padding:10px;">Interest</td>
          <td>${Number(balance.interest || 0).toLocaleString()}</td>
        </tr>

        <tr>
          <td style="padding:10px;">Total Owed</td>
          <td>${Number(balance.total_owed || 0).toLocaleString()}</td>
        </tr>

        <tr>
          <td style="padding:10px;">Total Paid</td>
          <td>${Number(balance.paid || 0).toLocaleString()}</td>
        </tr>

        <tr>
          <td style="padding:10px;">Remaining</td>
          <td>${Number(balance.balance || 0).toLocaleString()}</td>
        </tr>

        <tr>
          <td style="padding:10px;">Start Date</td>
          <td>${formatDate(l.start_date)}</td>
        </tr>

        <tr>
          <td style="padding:10px;">Due Date</td>
          <td>${formatDate(l.due_date)}</td>
        </tr>

        <tr>
          <td style="padding:10px;">Status</td>
          <td>${l.status}</td>
        </tr>

        <!-- 🔷 PAYMENT HEADER -->
        <tr style="background:#f5f5f5;">
          <th style="padding:10px;">Date</th>
          <th style="padding:10px;">Amount Paid</th>
        </tr>

        <!-- 🔷 PAYMENTS -->
        ${paymentRows}

        <!-- 🔷 TOTAL -->
        <tr style="background:#e8f5e9; font-weight:bold;">
          <td style="padding:10px;">Total Paid</td>
          <td style="padding:10px;">
            ${Number(balance.paid || 0).toLocaleString()}
          </td>
        </tr>

      </table>
    `;
  }

  container.innerHTML = `
    <div id="report" style="padding:30px; background:#f9f9f9; border-radius:10px;">
      <h2 style="text-align:center;">Customer Loan Report</h2>
      <p><strong>Email:</strong> ${targetEmail}</p>
      <hr style="margin:30px 0;">
      ${fullHTML}
    </div>
  `;
}



function printReport() {
  const content = document.getElementById("report").innerHTML;

  const win = window.open("", "", "width=900,height=700");
  win.document.write(`
    <html>
      <head>
        <title>Print Report</title>
      </head>
      <body>
        ${content}
      </body>
    </html>
  `);

  win.document.close();
  win.print();
}



function makePayment(loanId, input, balanceElement) {
  const amount = parseFloat(input.value);

  if (!amount || amount <= 0) {
    alert("ivalid amount");
    return;
  }
  
  if (input.max && amount > input.max) {
    alert("Amount exceeds remaining balance");
    return
  }

  fetch(`${API_URL}/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token
    },
    body: JSON.stringify({
      loan_id: loanId,
      amount: amount,
    })
  })
  .then(res => res.text())
  .then(msg => {
    if(msg) {
      alert("Amount payed successfully!")
    }

    loadMyLoans();

    input.value = "";
  })
  .catch(err => console.log(err));
}

function createLoan() {
  const email = selectedEmail;
  const amount = parseFloat(document.getElementById("loanAmount").value);
  const interest_rate = parseFloat(document.getElementById("interest").value);
  const start_date = document.getElementById("startDate").value;
  const due_date = document.getElementById("dueDate").value;

  // 🔒 VALIDATION

  if (!email) {
    alert("Please select a customer");
    return;
  }

  if (!amount || amount <= 0) {
    alert("Loan amount must be greater than 0");
    return;
  }

  // Optional realistic minimum
  if (amount < 1000) {
    alert("Minimum loan amount is 1,000");
    return;
  }

  if (isNaN(interest_rate) || interest_rate < 0) {
    alert("Interest rate must be 0 or more");
    return;
  }

  if (interest_rate > 100) {
    alert("Interest rate is too high");
    return;
  }

  if (!start_date || !due_date) {
    alert("Please select start date and due date");
    return;
  }

  if (new Date(due_date) <= new Date(start_date)) {
    alert("Due date must be after start date");
    return;
  }

  // 🚀 SEND REQUEST
  fetch(`${API_URL}/loans`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token
    },
    body: JSON.stringify({
      email,
      amount,
      interest_rate,
      start_date,
      due_date
    })
  })
  .then(res => res.text())
  .then(msg => {
    alert(msg);

    // 🧹 reset form after success
    document.getElementById("loanAmount").value = "";
    document.getElementById("interest").value = "";
    document.getElementById("startDate").value = "";
    document.getElementById("dueDate").value = "";
    selectedEmail = "";
    document.getElementById("loanSearch").value = "";
  })
  .then(res => {
    if (!res.ok) {
      return res.text().then(msg => { throw new Error(msg); });
    }
    return res.text();
  })
  .then(msg => {
    alert(msg);
  })
  .catch(err => {
    console.log(err.message);
  });

}



document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("email").addEventListener("input", () => {
    document.getElementById("loginError").textContent = "";
  });

  document.getElementById("password").addEventListener("input", () => {
    document.getElementById("loginError").textContent = "";
  });
});


function logout() {
  token = null;

  localStorage.removeItem("token");

  document.getElementById("adminPanel").style.display = "none";
  document.getElementById("customerPanel").style.display = "none";

  document.getElementById("login").style.display = "block";

  document.getElementById("email").value = "";
  document.getElementById("password").value = "";

  document.getElementById("welcomeText").textContent = "";
  
}

document.addEventListener("DOMContentLoaded", () => {

  const savedToken = localStorage.getItem("token");

  if (savedToken) {
    token = savedToken;

    const user = parseJwt(token);

    // Hide login
    document.getElementById("login").style.display = "none";

    // Show welcome text
    document.getElementById("welcomeText").textContent =
      "Welcome " + user.name;

    // Show correct panel
    if (user.role === "admin") {
      document.getElementById("adminPanel").style.display = "block";
    } else {
      document.getElementById("customerPanel").style.display = "block";
    }
  }

});