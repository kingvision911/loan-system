const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: "kingvision911@gmail.com",
        pass: "xxhggrgxkdvnfqyi"
    }
});

module.exports = transporter;