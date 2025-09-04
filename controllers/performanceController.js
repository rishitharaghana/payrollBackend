const pool = require("../config/db");
const util = require("util");
const queryAsync = util.promisify(pool.query).bind(pool);

const setEmployeeGoal = async (req, res) => {
  const userRole = req.user.role;
  const { employee_id, title, description, due_date, tasks } = req.body;

  if (!["super_admin", "hr"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied: Only HR or Admin can set goals" });
  }

  if (!employee_id || !title || !due_date) {
    return res.status(400).json({ error: "Employee ID, title, and due date are required" });
  }

  try {
    const [employee] = await queryAsync("SELECT employee_id FROM hrms_users WHERE employee_id = ?", [employee_id]);
    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    const goalQuery = `
      INSERT INTO goals (employee_id, title, description, due_date, created_by)
      VALUES (?, ?, ?, ?, ?)
    `;
    const goalValues = [employee_id, title, description || null, due_date, req.user.employee_id];
    const goalResult = await queryAsync(goalQuery, goalValues);
    const goalId = goalResult.insertId;

    let insertedTasks = [];
    if (tasks && Array.isArray(tasks)) {
      for (const task of tasks) {
        const taskQuery = `
          INSERT INTO tasks (goal_id, employee_id, title, description, due_date, priority)
          VALUES (?, ?, ?, ?, ?, ?)
        `;
        const taskValues = [goalId, employee_id, task.title, task.description || null, task.due_date, task.priority || "Medium"];
        const taskResult = await queryAsync(taskQuery, taskValues);
        insertedTasks.push({ id: taskResult.insertId, ...task });
      }
    }

    res.status(201).json({
      message: "Goal and tasks set successfully",
      data: { id: goalId, employee_id, title, description, due_date, tasks: insertedTasks },
    });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error during goal setting" });
  }
};

const fetchEmployeePerformance = async (req, res) => {
  const { employee_id } = req.params;
  const userRole = req.user.role;
  const userEmployeeId = req.user.employee_id;

  console.log("fetchEmployeePerformance - Request received:", {
    employee_id,
    userRole,
    userEmployeeId,
  });

  if (!employee_id) {
    console.log("fetchEmployeePerformance - Error: Employee ID is required");
    return res.status(400).json({ error: "Employee ID is required" });
  }

  if (
    !["super_admin", "hr", "dept_head", "employee"].includes(userRole) ||
    (userRole === "employee" && userEmployeeId !== employee_id)
  ) {
    console.log("fetchEmployeePerformance - Error: Access denied", {
      userRole,
      userEmployeeId,
      employee_id,
    });
    return res.status(403).json({ error: "Access denied" });
  }

  try {
    console.log("fetchEmployeePerformance - Querying employee:", { employee_id });
    const [employee] = await queryAsync(
      "SELECT employee_id FROM hrms_users WHERE employee_id = ?",
      [employee_id]
    );

    if (!employee) {
      console.log("fetchEmployeePerformance - Employee not found:", { employee_id });
      return res.status(404).json({
        message: "Employee not found",
        data: {
          goals: [],
          tasks: [],
          competencies: [],
          achievements: [],
          feedback: [],
          learningGrowth: [],
        },
      });
    }

    console.log("fetchEmployeePerformance - Fetching goals for:", { employee_id });
    const [goals] = await queryAsync(
      "SELECT id, title, description, due_date, progress, status FROM goals WHERE employee_id = ?",
      [employee_id]
    );

    console.log("fetchEmployeePerformance - Fetching tasks for:", { employee_id });
    const [tasks] = await queryAsync(
      "SELECT id, goal_id, title, description, due_date, priority, progress, status FROM tasks WHERE employee_id = ?",
      [employee_id]
    );

    console.log("fetchEmployeePerformance - Fetching competencies for:", { employee_id });
    const [competencies] = await queryAsync(
      "SELECT skill, self_rating, manager_rating, feedback FROM competencies WHERE employee_id = ?",
      [employee_id]
    );

    console.log("fetchEmployeePerformance - Fetching achievements for:", { employee_id });
    const [achievements] = await queryAsync(
      "SELECT title, date, type FROM achievements WHERE employee_id = ?",
      [employee_id]
    );

    console.log("fetchEmployeePerformance - Fetching feedback for:", { employee_id });
    const [feedback] = await queryAsync(
      "SELECT source, comment, timestamp FROM feedback WHERE employee_id = ?",
      [employee_id]
    );

    console.log("fetchEmployeePerformance - Fetching learningGrowth for:", { employee_id });
    const [learningGrowth] = await queryAsync(
      "SELECT title, progress, completed FROM learning_growth WHERE employee_id = ?",
      [employee_id]
    );

    console.log("fetchEmployeePerformance - Fetched data:", {
      goals: goals || [],
      tasks: tasks || [],
      competencies: competencies || [],
      achievements: achievements || [],
      feedback: feedback || [],
      learningGrowth: learningGrowth || [],
    });

    return res.status(200).json({
      message: "Performance data fetched successfully",
      data: {
        goals: goals || [],
        tasks: tasks || [],
        competencies: competencies || [],
        achievements: achievements || [],
        feedback: feedback || [],
        learningGrowth: learningGrowth || [],
      },
    });
  } catch (err) {
    console.error("fetchEmployeePerformance - Database error:", {
      error: err.message,
      employee_id,
    });
    return res.status(500).json({ error: `Database error: ${err.message}` });
  }
};

const submitSelfReview = async (req, res) => {
  const { employee_id, comments } = req.body;
  const userEmployeeId = req.user.employee_id;

  if (userEmployeeId !== employee_id) {
    return res.status(403).json({ error: "Access denied: Can only submit self-review for yourself" });
  }

  if (!comments?.trim()) {
    return res.status(400).json({ error: "Comments are required" });
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

const conductAppraisal = async (req, res) => {
  const userRole = req.user.role;
  const { employee_id, performance_score, manager_comments, achievements, competencies, bonus_eligible, promotion_recommended, salary_hike_percentage } = req.body;

  if (!["super_admin", "hr"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied: Only HR or Admin can conduct appraisals" });
  }

  try {
    const [employee] = await queryAsync("SELECT employee_id FROM hrms_users WHERE employee_id = ?", [employee_id]);
    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    if (manager_comments) {
      await queryAsync(
        "INSERT INTO feedback (employee_id, source, comment, timestamp) VALUES (?, ?, ?, NOW())",
        [employee_id, "Manager", manager_comments]
      );
    }

    if (competencies && Array.isArray(competencies)) {
      for (const comp of competencies) {
        await queryAsync(
          "INSERT INTO competencies (employee_id, skill, manager_rating, feedback) VALUES (?, ?, ?, ?)",
          [employee_id, comp.skill, comp.manager_rating, comp.feedback]
        );
      }
    }

    if (achievements && Array.isArray(achievements)) {
      for (const ach of achievements) {
        await queryAsync(
          "INSERT INTO achievements (employee_id, title, date, type) VALUES (?, ?, ?, ?)",
          [employee_id, ach.title, ach.date, ach.type]
        );
      }
    }

    res.status(201).json({ message: "Appraisal conducted successfully" });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error during appraisal" });
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


module.exports = { setEmployeeGoal, updateGoalProgress, conductAppraisal, fetchEmployeePerformance, submitSelfReview };