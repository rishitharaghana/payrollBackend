const pool = require("../config/db");
const util = require("util");
const queryAsync = util.promisify(pool.query).bind(pool);

const fetchEmployeePerformance = async (req, res) => {
  const { employee_id } = req.params;
  const userRole = req.user.role;
  const userEmployeeId = req.user.employee_id;

  if (!["super_admin", "hr", "dept_head", "employee"].includes(userRole) || (userRole === "employee" && userEmployeeId !== employee_id)) {
    return res.status(403).json({ error: "Access denied" });
  }

  try {
    const goals = await queryAsync(
      "SELECT id, title, description, due_date, progress, status FROM goals WHERE employee_id = ?",
      [employee_id]
    );

    const competencies = await queryAsync(
      "SELECT skill, self_rating, manager_rating, feedback FROM competencies WHERE employee_id = ?",
      [employee_id]
    );

    const achievements = await queryAsync(
      "SELECT title, date, type FROM achievements WHERE employee_id = ?",
      [employee_id]
    );

    const feedback = await queryAsync(
      "SELECT source, comment, timestamp FROM feedback WHERE employee_id = ?",
      [employee_id]
    );

    const learningGrowth = await queryAsync(
      "SELECT title, progress, completed FROM learning_growth WHERE employee_id = ?",
      [employee_id]
    );

    res.json({
      message: "Performance data fetched successfully",
      data: {
        goals,
        competencies,
        achievements,
        feedback,
        learningGrowth,
      },
    });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error" });
  }
};

const submitSelfReview = async (req, res) => {
  const { employee_id, comments } = req.body;
  const userEmployeeId = req.user.employee_id;

  if (userEmployeeId !== employee_id) {
    return res.status(403).json({ error: "Access denied: Can only submit self-review for yourself" });
  }

  try {
    await queryAsync(
      "INSERT INTO feedback (employee_id, source, comment, timestamp) VALUES (?, ?, ?, NOW())",
      [employee_id, "Self", comments]
    );
    res.status(201).json({ message: "Self-review comments submitted successfully" });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error during self-review submission" });
  }
};

const setEmployeeGoal = async (req, res) => {
  const userRole = req.user.role;
  const { employee_id, title, description, due_date } = req.body;

  if (!["super_admin", "hr"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied: Only HR or Admin can set goals" });
  }

  if (!employee_id || !title || !due_date) {
    return res.status(400).json({ error: "Employee ID, title, and due date are required" });
  }

  try {
    const [employee] = await queryAsync(
      "SELECT employee_id FROM hrms_users WHERE employee_id = ?",
      [employee_id]
    );
    if (!employee) {
      return res.status(404).json({ error: "Employee not found in the system" });
    }

    const query = `
      INSERT INTO goals (employee_id, title, description, due_date, created_by)
      VALUES (?, ?, ?, ?, ?)
    `;
    const values = [
      employee_id,
      title,
      description || null,
      due_date,
      req.user.employee_id || null,
    ];
    const result = await queryAsync(query, values);

    res.status(201).json({
      message: "Goal set successfully",
      data: {
        id: result.insertId,
        employee_id,
        title,
        description,
        due_date,
        created_by: req.user.employee_id,
      },
    });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error during goal setting" });
  }
};


const updateGoalProgress = async (req, res) => {
  const userRole = req.user.role;
  const { goal_id } = req.params;
  const { progress, status } = req.body;

  if (!["super_admin", "hr", "dept_head", "employee"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied" });
  }

  if (!progress || !status || !["Not Started", "In Progress", "Completed", "At Risk"].includes(status)) {
    return res.status(400).json({ error: "Progress (0-100) and valid status are required" });
  }

  try {
    // Verify goal exists and user has permission
    const [goal] = await queryAsync("SELECT employee_id, created_by FROM goals WHERE id = ?", [goal_id]);
    if (!goal) {
      return res.status(404).json({ error: "Goal not found" });
    }
    if (userRole === "employee" && goal.employee_id !== req.user.employee_id) {
      return res.status(403).json({ error: "Employees can only update their own goals" });
    }
    if (userRole === "dept_head" && goal.employee_id !== req.user.employee_id && goal.created_by !== req.user.employee_id) {
      return res.status(403).json({ error: "Department heads can only update their own goals or goals they created" });
    }

    const query = "UPDATE goals SET progress = ?, status = ?, updated_at = NOW() WHERE id = ?";
    await queryAsync(query, [Math.max(0, Math.min(100, progress)), status, goal_id]);

    res.json({ message: "Goal progress updated successfully", data: { goal_id, progress, status } });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error during goal update" });
  }
};

const conductAppraisal = async (req, res) => {
  const userRole = req.user.role;
  const { employee_id, performance_score, manager_comments, achievements, bonus_eligible, promotion_recommended, salary_hike_percentage } = req.body;

  if (!["super_admin", "hr"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied: Only HR or Admin can conduct appraisals" });
  }

  if (!employee_id || !performance_score || !manager_comments || !achievements) {
    return res.status(400).json({ error: "Employee ID, performance score, manager comments, and achievements are required" });
  }

  try {
    // Verify employee exists
    const [employee] = await queryAsync(
      `SELECT employee_id FROM (
        SELECT employee_id FROM employees WHERE employee_id = ?
        UNION
        SELECT employee_id FROM dept_heads WHERE employee_id = ?
      ) AS all_employees`,
      [employee_id, employee_id]
    );
    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    // Check if goals exist and are due for appraisal
    const [goals] = await queryAsync(
      "SELECT COUNT(*) as count FROM goals WHERE employee_id = ? AND due_date <= CURDATE()",
      [employee_id]
    );
    if (goals.count === 0) {
      return res.status(400).json({ error: "No goals due for appraisal for this employee" });
    }

    const query = `
      INSERT INTO performance_reviews (employee_id, review_date, reviewer_id, performance_score, manager_comments, achievements, bonus_eligible, promotion_recommended, salary_hike_percentage)
      VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?, ?)
    `;
    const values = [
      employee_id,
      req.user.employee_id,
      Math.max(0, Math.min(100, performance_score)),
      manager_comments,
      JSON.stringify(achievements),
      !!bonus_eligible,
      !!promotion_recommended,
      salary_hike_percentage || 0,
    ];
    const result = await queryAsync(query, values);

    res.status(201).json({
      message: "Appraisal conducted successfully",
      data: {
        id: result.insertId,
        employee_id,
        review_date: new Date().toISOString().split("T")[0],
        reviewer_id: req.user.employee_id,
        performance_score,
        manager_comments,
        achievements,
        bonus_eligible,
        promotion_recommended,
        salary_hike_percentage,
      },
    });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error during appraisal" });
  }
};



module.exports = { setEmployeeGoal, updateGoalProgress, conductAppraisal, fetchEmployeePerformance, submitSelfReview };