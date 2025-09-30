const util = require("util");
const pool = require("../config/db");

const queryAsync = util.promisify(pool.query).bind(pool);

// Validate date format (YYYY-MM-DD)
const validateDate = (date) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid date format. Use YYYY-MM-DD");
  }
  const parsedDate = new Date(date);
  if (isNaN(parsedDate.getTime())) {
    throw new Error("Invalid date");
  }
  return true;
};

// Create a holiday
const createHoliday = async (req, res) => {
  const userRole = req.user?.role;
  if (!["super_admin", "hr"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied: Only HR or super admin can create holidays" });
  }

  const { holiday_date, description, type } = req.body;
  if (!holiday_date || !description || !type) {
    return res.status(400).json({ error: "Holiday date, description, and type are required" });
  }

  try {
    validateDate(holiday_date);
    const [existingHoliday] = await queryAsync(
      "SELECT id FROM holidays WHERE holiday_date = ?",
      [holiday_date]
    );
    if (existingHoliday) {
      return res.status(400).json({ error: `Holiday already exists on ${holiday_date}` });
    }

    const result = await queryAsync(
      "INSERT INTO holidays (holiday_date, description, type, updated_at) VALUES (?, ?, ?, NOW())",
      [holiday_date, description.trim(), type.trim()]
    );

    res.status(201).json({
      message: "Holiday created successfully",
      data: { id: result.insertId, holiday_date, description, type },
    });
  } catch (err) {
    console.error("Error creating holiday:", err.message, err.sqlMessage);
    res.status(500).json({
      error: "Failed to create holiday",
      details: err.sqlMessage || err.message,
    });
  }
};

// Get all holidays for a year
const getHolidays = async (req, res) => {
  const { year } = req.query;
  if (!year || !/^\d{4}$/.test(year)) {
    return res.status(400).json({ error: "Valid year is required" });
  }

  try {
    const holidays = await queryAsync(
      "SELECT id, holiday_date, description, type, updated_at FROM holidays WHERE YEAR(holiday_date) = ? ORDER BY holiday_date",
      [year]
    );

    res.json({
      message: "Holidays fetched successfully",
      data: holidays,
    });
  } catch (err) {
    console.error("Error fetching holidays:", err.message, err.sqlMessage);
    res.status(500).json({
      error: "Failed to fetch holidays",
      details: err.sqlMessage || err.message,
    });
  }
};

// Update a holiday
const updateHoliday = async (req, res) => {
  const userRole = req.user?.role;
  if (!["super_admin", "hr"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied: Only HR or super admin can update holidays" });
  }

  const { id } = req.params;
  const { holiday_date, description, type } = req.body;
  if (!holiday_date || !description || !type) {
    return res.status(400).json({ error: "Holiday date, description, and type are required" });
  }

  try {
    validateDate(holiday_date);
    const [existingHoliday] = await queryAsync(
      "SELECT id FROM holidays WHERE id = ?",
      [id]
    );
    if (!existingHoliday) {
      return res.status(404).json({ error: `Holiday with ID ${id} not found` });
    }

    await queryAsync(
      "UPDATE holidays SET holiday_date = ?, description = ?, type = ?, updated_at = NOW() WHERE id = ?",
      [holiday_date, description.trim(), type.trim(), id]
    );

    res.json({
      message: "Holiday updated successfully",
      data: { id, holiday_date, description, type },
    });
  } catch (err) {
    console.error("Error updating holiday:", err.message, err.sqlMessage);
    res.status(500).json({
      error: "Failed to update holiday",
      details: err.sqlMessage || err.message,
    });
  }
};

// Delete a holiday
const deleteHoliday = async (req, res) => {
  const userRole = req.user?.role;
  if (!["super_admin", "hr"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied: Only HR or super admin can delete holidays" });
  }

  const { id } = req.params;

  try {
    const [existingHoliday] = await queryAsync(
      "SELECT id FROM holidays WHERE id = ?",
      [id]
    );
    if (!existingHoliday) {
      return res.status(404).json({ error: `Holiday with ID ${id} not found` });
    }

    await queryAsync("DELETE FROM holidays WHERE id = ?", [id]);

    res.json({ message: "Holiday deleted successfully" });
  } catch (err) {
    console.error("Error deleting holiday:", err.message, err.sqlMessage);
    res.status(500).json({
      error: "Failed to delete holiday",
      details: err.sqlMessage || err.message,
    });
  }
};

module.exports = {
  createHoliday,
  getHolidays,
  updateHoliday,
  deleteHoliday,
};