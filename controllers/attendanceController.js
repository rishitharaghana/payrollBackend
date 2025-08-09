const pool = require("../config/db");

const getAttendance = async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM attendance");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Database error" });
  }
};

const markAttendance = async (req, res) => {
  const { employee_id, date, status } = req.body;
  try {
    await pool.query("INSERT INTO attendance (employee_id, date, status) VALUES (?, ?, ?)", [employee_id, date, status]);
    res.status(201).json({ message: "Attendance marked" });
  } catch (err) {
    res.status(500).json({ error: "Database error" });
  }
};

module.exports = { getAttendance, markAttendance };
